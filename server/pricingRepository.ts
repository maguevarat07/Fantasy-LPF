import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from './db.js';

export type PricingRunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface PricingRunRecord {
  id: string;
  tournamentId: string;
  asOfGameweekId: string;
  formulaVersion: string;
  configJson: string;
  inputHash: string;
  status: PricingRunStatus;
  createdAt: string;
  completedAt: string | null;
}

export interface StartPricingRunInput {
  id?: string;
  tournamentId: string;
  asOfGameweekId: string;
  formulaVersion: string;
  config: unknown;
  inputHash: string;
  createdAt?: string;
}

export interface PersistedPlayerPrice {
  playerId: string;
  currentPriceCents: number;
  fairPriceCents: number;
  seasonPointsPercentile: number;
  recentFormPercentile: number;
  pointsPerAppearancePercentile: number;
  performanceIndex: number;
  adjustedPerformance: number;
  confidence: number;
  seasonPoints: number;
  recentForm: number;
  pointsPerAppearance: number;
  participationRate: number | null;
  marketMomentum?: number;
}

export interface CompletePricingRunInput {
  runId: string;
  prices: readonly PersistedPlayerPrice[];
  completedAt?: string;
}

export interface CompletePricingRunResult {
  applied: boolean;
  updatedPlayers: number;
}

interface PricingRunRow {
  id: string;
  tournament_id: string;
  as_of_gameweek_id: string;
  formula_version: string;
  config_json: string;
  input_hash: string;
  status: PricingRunStatus;
  created_at: string;
  completed_at: string | null;
}

function mapRun(row: PricingRunRow): PricingRunRecord {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    asOfGameweekId: row.as_of_gameweek_id,
    formulaVersion: row.formula_version,
    configJson: row.config_json,
    inputHash: row.input_hash,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function requireIntegerMoney(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} debe ser un entero monetario no negativo.`);
  }
}

function requireFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) throw new Error(`${field} debe ser finito.`);
}

function validatePrice(price: PersistedPlayerPrice): void {
  requireIntegerMoney(price.currentPriceCents, 'currentPriceCents');
  requireIntegerMoney(price.fairPriceCents, 'fairPriceCents');
  requireFinite(price.seasonPointsPercentile, 'seasonPointsPercentile');
  requireFinite(price.recentFormPercentile, 'recentFormPercentile');
  requireFinite(price.pointsPerAppearancePercentile, 'pointsPerAppearancePercentile');
  requireFinite(price.performanceIndex, 'performanceIndex');
  requireFinite(price.adjustedPerformance, 'adjustedPerformance');
  requireFinite(price.confidence, 'confidence');
  requireFinite(price.seasonPoints, 'seasonPoints');
  requireFinite(price.recentForm, 'recentForm');
  requireFinite(price.pointsPerAppearance, 'pointsPerAppearance');
  if (price.participationRate !== null) requireFinite(price.participationRate, 'participationRate');
  requireFinite(price.marketMomentum ?? 0, 'marketMomentum');
}

export function getPricingRun(db: SqliteDatabase, runId: string): PricingRunRecord | undefined {
  const row = db.prepare('SELECT * FROM pricing_runs WHERE id = ?').get(runId) as PricingRunRow | undefined;
  return row ? mapRun(row) : undefined;
}

/**
 * Registers an idempotent pricing attempt. A completed calculation for the same
 * tournament/gameweek/version cannot be silently replaced by different inputs.
 */
export function startPricingRun(db: SqliteDatabase, input: StartPricingRunInput): PricingRunRecord {
  const existingPeriod = db.prepare(`SELECT * FROM pricing_runs
    WHERE tournament_id = ? AND as_of_gameweek_id = ? AND formula_version = ?
      AND status = 'COMPLETED'
    ORDER BY completed_at DESC LIMIT 1`).get(
    input.tournamentId, input.asOfGameweekId, input.formulaVersion,
  ) as PricingRunRow | undefined;
  if (existingPeriod && existingPeriod.input_hash !== input.inputHash) {
    throw new Error('Ya existe un cálculo completado con otra entrada para esta jornada y versión.');
  }

  const sameInput = db.prepare(`SELECT * FROM pricing_runs
    WHERE tournament_id = ? AND as_of_gameweek_id = ? AND formula_version = ? AND input_hash = ?`)
    .get(input.tournamentId, input.asOfGameweekId, input.formulaVersion, input.inputHash) as PricingRunRow | undefined;
  if (sameInput) return mapRun(sameInput);

  const id = input.id ?? randomUUID();
  const createdAt = input.createdAt ?? new Date().toISOString();
  db.prepare(`INSERT INTO pricing_runs
    (id, tournament_id, as_of_gameweek_id, formula_version, config_json, input_hash, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', ?)`)
    .run(id, input.tournamentId, input.asOfGameweekId, input.formulaVersion,
      JSON.stringify(input.config), input.inputHash, createdAt);
  return getPricingRun(db, id)!;
}

/** Writes the complete price snapshot and current prices atomically. */
export function completePricingRun(
  db: SqliteDatabase,
  input: CompletePricingRunInput,
): CompletePricingRunResult {
  const completedAt = input.completedAt ?? new Date().toISOString();
  const playerIds = new Set<string>();
  input.prices.forEach(price => {
    validatePrice(price);
    if (playerIds.has(price.playerId)) throw new Error(`Jugador duplicado en pricing run: ${price.playerId}`);
    playerIds.add(price.playerId);
  });

  return db.transaction(() => {
    const run = getPricingRun(db, input.runId);
    if (!run) throw new Error('La ejecución de precios no existe.');
    if (run.status === 'COMPLETED') {
      const historyCount = Number((db.prepare('SELECT COUNT(*) AS total FROM player_price_history WHERE pricing_run_id = ?')
        .get(run.id) as { total: number }).total);
      if (historyCount !== input.prices.length) {
        throw new Error('La ejecución completada no coincide con el snapshot solicitado.');
      }
      return { applied: false, updatedPlayers: historyCount };
    }
    if (run.status !== 'RUNNING') throw new Error(`La ejecución no puede completarse desde ${run.status}.`);

    const loadCurrent = db.prepare(`SELECT price_cents AS priceCents
      FROM tournament_players WHERE tournament_id = ? AND player_id = ?`);
    const insertHistory = db.prepare(`INSERT INTO player_price_history
      (pricing_run_id, tournament_id, player_id, gameweek_id,
       previous_price_cents, current_price_cents, change_cents, fair_price_cents,
       season_points_percentile, recent_form_percentile, points_per_appearance_percentile,
       performance_index, adjusted_performance, confidence, season_points, recent_form,
       points_per_appearance, participation_rate, formula_version, effective_at, market_momentum)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const updateCurrent = db.prepare(`UPDATE tournament_players
      SET previous_price_cents = price_cents,
          price_cents = ?, fair_price_cents = ?, last_change_cents = ?,
          last_calculated_gameweek_id = ?, pricing_status = 'CURRENT',
          pricing_version = ?, price_updated_at = ?
      WHERE tournament_id = ? AND player_id = ?`);

    for (const price of input.prices) {
      const current = loadCurrent.get(run.tournamentId, price.playerId) as { priceCents: number } | undefined;
      if (!current) throw new Error(`El jugador ${price.playerId} no pertenece al torneo ${run.tournamentId}.`);
      const changeCents = price.currentPriceCents - current.priceCents;
      insertHistory.run(
        run.id, run.tournamentId, price.playerId, run.asOfGameweekId,
        current.priceCents, price.currentPriceCents, changeCents, price.fairPriceCents,
        price.seasonPointsPercentile, price.recentFormPercentile, price.pointsPerAppearancePercentile,
        price.performanceIndex, price.adjustedPerformance, price.confidence, price.seasonPoints,
        price.recentForm, price.pointsPerAppearance, price.participationRate,
        run.formulaVersion, completedAt, price.marketMomentum ?? 0,
      );
      updateCurrent.run(
        price.currentPriceCents, price.fairPriceCents, changeCents,
        run.asOfGameweekId, run.formulaVersion, completedAt,
        run.tournamentId, price.playerId,
      );
    }

    db.prepare(`UPDATE pricing_runs SET status = 'COMPLETED', completed_at = ?
      WHERE id = ? AND status = 'RUNNING'`).run(completedAt, run.id);
    return { applied: true, updatedPlayers: input.prices.length };
  })();
}

export function failPricingRun(db: SqliteDatabase, runId: string, failedAt = new Date().toISOString()): void {
  db.prepare(`UPDATE pricing_runs SET status = 'FAILED', completed_at = ?
    WHERE id = ? AND status = 'RUNNING'`).run(failedAt, runId);
}
