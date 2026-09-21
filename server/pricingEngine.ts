import { createHash } from 'node:crypto';
import type { SqliteDatabase } from './db.js';
import {
  DEFAULT_MARKET_MOMENTUM_CONFIG,
  loadMarketMomentum,
  marketMomentumConfigFromEnv,
  type MarketMomentumConfig,
  type MarketMomentumInput,
} from './marketMomentum.js';
import { completePricingRun, failPricingRun, startPricingRun } from './pricingRepository.js';

export type PricingPosition = 'GK' | 'DEF' | 'MID' | 'FWD';

export interface PricingConfig {
  formulaVersion: string;
  rangesCents: Record<PricingPosition, { min: number; max: number }>;
  weights: { season: number; recent: number; pointsPerAppearance: number; participation: number };
  recentWindowGameweeks: number;
  recentWeights: number[];
  gamma: number;
  shrinkageAppearances: number;
  roundToCents: number;
  movementThresholdsCents: readonly [number, number, number];
  maxMovementCents: number;
  marketMomentumEnabled: boolean;
  marketMomentumConfig: MarketMomentumConfig;
}

export const PRICING_CONFIG: Readonly<PricingConfig> = Object.freeze({
  formulaVersion: 'lpf-price-v2.0.0',
  rangesCents: {
    GK: { min: 400_000_000, max: 900_000_000 },
    DEF: { min: 400_000_000, max: 1_000_000_000 },
    MID: { min: 450_000_000, max: 1_400_000_000 },
    FWD: { min: 500_000_000, max: 1_800_000_000 },
  },
  weights: { season: 0.50, recent: 0.30, pointsPerAppearance: 0.15, participation: 0.05 },
  recentWindowGameweeks: 3,
  recentWeights: [1, 1, 1],
  gamma: 2,
  shrinkageAppearances: 6,
  roundToCents: 10_000_000,
  movementThresholdsCents: [10_000_000, 20_000_000, 30_000_000] as const,
  maxMovementCents: 30_000_000,
  marketMomentumEnabled: false,
  marketMomentumConfig: DEFAULT_MARKET_MOMENTUM_CONFIG,
});

export function pricingConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PricingConfig {
  const marketMomentumConfig = marketMomentumConfigFromEnv(env);
  return {
    ...PRICING_CONFIG,
    formulaVersion: marketMomentumConfig.enabled
      ? `${PRICING_CONFIG.formulaVersion}+momentum-v1`
      : PRICING_CONFIG.formulaVersion,
    marketMomentumEnabled: marketMomentumConfig.enabled,
    marketMomentumConfig,
  };
}

export interface PlayerPricingInput {
  playerId: string;
  position: PricingPosition;
  seasonPoints: number;
  recentGameweekPoints: number[];
  appearances: number;
  eligibleMatches: number;
  previousPriceCents: number;
  momentum?: MarketMomentumInput;
}

export interface PricingEngineInput {
  tournamentId: string;
  asOfGameweekId: string;
  players: PlayerPricingInput[];
  config: PricingConfig;
}

export interface PlayerPriceQuote {
  playerId: string;
  currentPriceCents: number;
  previousPriceCents: number;
  priceChangeCents: number;
  fairPriceCents: number;
  seasonPointsPercentile: number;
  recentFormPercentile: number;
  pointsPerAppearancePercentile: number;
  performanceIndex: number;
  adjustedPerformance: number;
  confidence: number;
  recentForm: number;
  pointsPerAppearance: number;
  participationRate: number | null;
  marketMomentum: number;
  marketMomentumPressureCents: number;
  formulaVersion: string;
  inputHash: string;
}

export interface PricingRunResult {
  runId: string;
  tournamentId: string;
  asOfGameweekId: string;
  formulaVersion: string;
  inputHash: string;
  updated: number;
  bootstrap: boolean;
  idempotent: boolean;
  quotes: PlayerPriceQuote[];
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export function roundMoney(priceCents: number, stepCents = PRICING_CONFIG.roundToCents): number {
  if (!Number.isFinite(priceCents) || Math.abs(priceCents) > Number.MAX_SAFE_INTEGER
      || !Number.isSafeInteger(stepCents) || stepCents <= 0) {
    throw new Error('El importe debe ser finito y el paso debe ser un entero seguro positivo.');
  }
  return Math.round(priceCents / stepCents) * stepCents;
}

export function midrankPercentiles<T>(
  values: readonly T[],
  valueOf: (value: T) => number,
  keyOf: (value: T) => string,
): Map<string, number> {
  const sorted = [...values].sort((a, b) => valueOf(a) - valueOf(b) || keyOf(a).localeCompare(keyOf(b)));
  const result = new Map<string, number>();
  if (sorted.length === 1) {
    result.set(keyOf(sorted[0]), 0.5);
    return result;
  }
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (end + 1 < sorted.length && valueOf(sorted[end + 1]) === valueOf(sorted[start])) end += 1;
    const percentile = ((start + end) / 2) / (sorted.length - 1);
    for (let index = start; index <= end; index += 1) result.set(keyOf(sorted[index]), percentile);
    start = end + 1;
  }
  return result;
}

export function calculateRecentForm(points: readonly number[], config: PricingConfig = PRICING_CONFIG): number {
  const window = points.slice(-config.recentWindowGameweeks);
  if (!window.length) return 0;
  const configuredWeights = config.recentWeights.slice(-config.recentWindowGameweeks);
  if (configuredWeights.length !== config.recentWindowGameweeks || configuredWeights.some(weight => weight < 0)) {
    throw new Error('recentWeights debe cubrir la ventana y no puede contener pesos negativos.');
  }
  const weights = configuredWeights.slice(-window.length);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) throw new Error('La suma de recentWeights debe ser positiva.');
  return window.reduce((sum, value, index) => sum + value * weights[index], 0) / totalWeight;
}

export function applyGradualMovement(previous: number, fair: number, config: PricingConfig = PRICING_CONFIG): number {
  const difference = fair - previous;
  const absolute = Math.abs(difference);
  const [small, medium, large] = config.movementThresholdsCents;
  let movement = 0;
  if (absolute >= large) movement = config.maxMovementCents;
  else if (absolute >= medium) movement = medium;
  else if (absolute >= small) movement = small;
  return roundMoney(previous + Math.sign(difference) * movement, config.roundToCents);
}

export function applyMarketPressure(
  sportPriceCents: number,
  previousPriceCents: number,
  pressureCents: number,
  range: { min: number; max: number },
  config: PricingConfig = PRICING_CONFIG,
): number {
  const boundedPressure = clamp01(Math.abs(pressureCents) / Math.max(1, config.marketMomentumConfig.maxPriceImpactCents))
    * config.marketMomentumConfig.maxPriceImpactCents * Math.sign(pressureCents);
  const lower = Math.max(range.min, previousPriceCents - config.maxMovementCents);
  const upper = Math.min(range.max, previousPriceCents + config.maxMovementCents);
  return Math.min(upper, Math.max(lower, roundMoney(sportPriceCents + boundedPressure, config.roundToCents)));
}

function median(values: readonly number[]): number {
  if (!values.length) return 0.5;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function pricingInputHash(input: PricingEngineInput, bootstrap: boolean): string {
  return createHash('sha256').update(JSON.stringify({
    tournamentId: input.tournamentId,
    asOfGameweekId: input.asOfGameweekId,
    bootstrap,
    config: input.config,
    players: [...input.players].sort((a, b) => a.playerId.localeCompare(b.playerId)),
  })).digest('hex');
}

export interface PricingInputSnapshot {
  snapshotVersion: 1;
  algorithmVersion: string;
  bootstrap: boolean;
  input: PricingEngineInput;
}

/** Preserves the exact player population and numeric inputs supplied to this run. */
export function createPricingInputSnapshot(input: PricingEngineInput, bootstrap: boolean): string {
  return JSON.stringify({ snapshotVersion: 1, algorithmVersion: input.config.formulaVersion,
    bootstrap, input } satisfies PricingInputSnapshot);
}

export function replayPricingInputSnapshot(snapshotJson: string, expectedHash: string): PlayerPriceQuote[] {
  const snapshot = JSON.parse(snapshotJson) as PricingInputSnapshot;
  if (snapshot.snapshotVersion !== 1 || snapshot.algorithmVersion !== snapshot.input?.config?.formulaVersion
      || !snapshot.algorithmVersion.startsWith(PRICING_CONFIG.formulaVersion)
      || typeof snapshot.bootstrap !== 'boolean' || !Array.isArray(snapshot.input.players)) {
    throw new Error('Versión o contenido de snapshot de pricing no compatible.');
  }
  if (pricingInputHash(snapshot.input, snapshot.bootstrap) !== expectedHash) {
    throw new Error('El snapshot de pricing no coincide con el hash de entrada persistido.');
  }
  return calculatePriceQuotes(snapshot.input, { bootstrap: snapshot.bootstrap });
}

export function calculatePriceQuotes(input: PricingEngineInput, options: { bootstrap?: boolean } = {}): PlayerPriceQuote[] {
  const bootstrap = options.bootstrap ?? false;
  const hash = pricingInputHash(input, bootstrap);
  const prepared = input.players.map(player => ({
    ...player,
    recentForm: calculateRecentForm(player.recentGameweekPoints, input.config),
    pointsPerAppearance: player.appearances > 0 ? player.seasonPoints / player.appearances : 0,
    participationRate: player.eligibleMatches > 0 ? clamp01(player.appearances / player.eligibleMatches) : null,
  }));
  const positions: PricingPosition[] = ['GK', 'DEF', 'MID', 'FWD'];
  const quotes: PlayerPriceQuote[] = [];

  for (const position of positions) {
    const players = prepared.filter(player => player.position === position);
    if (!players.length) continue;
    const season = midrankPercentiles(players, player => player.seasonPoints, player => player.playerId);
    const recent = midrankPercentiles(players, player => player.recentForm, player => player.playerId);
    const perAppearance = midrankPercentiles(players, player => player.pointsPerAppearance, player => player.playerId);
    const raw = players.map(player => {
      const seasonPointsPercentile = season.get(player.playerId) ?? 0.5;
      const recentFormPercentile = recent.get(player.playerId) ?? 0.5;
      const pointsPerAppearancePercentile = perAppearance.get(player.playerId) ?? 0.5;
      const performanceIndex = clamp01(
        input.config.weights.season * seasonPointsPercentile
        + input.config.weights.recent * recentFormPercentile
        + input.config.weights.pointsPerAppearance * pointsPerAppearancePercentile
        + input.config.weights.participation * (player.participationRate ?? 0),
      );
      return { player, seasonPointsPercentile, recentFormPercentile, pointsPerAppearancePercentile, performanceIndex };
    });
    const positionalMedian = median(raw.map(value => value.performanceIndex));
    const range = input.config.rangesCents[position];
    for (const value of raw) {
      const confidence = clamp01(value.player.appearances / input.config.shrinkageAppearances);
      const adjustedPerformance = clamp01(value.performanceIndex * confidence + positionalMedian * (1 - confidence));
      const fairPriceCents = Math.min(range.max, Math.max(range.min, roundMoney(
        range.min + (range.max - range.min) * Math.pow(adjustedPerformance, input.config.gamma),
        input.config.roundToCents,
      )));
      const sportPriceCents = bootstrap ? fairPriceCents : Math.min(range.max, Math.max(
        range.min, applyGradualMovement(value.player.previousPriceCents, fairPriceCents, input.config),
      ));
      const marketMomentum = bootstrap ? 0 : (value.player.momentum?.momentum ?? 0);
      const marketMomentumPressureCents = bootstrap ? 0 : (value.player.momentum?.pricePressureCents ?? 0);
      const currentPriceCents = bootstrap ? sportPriceCents : applyMarketPressure(
        sportPriceCents,
        value.player.previousPriceCents,
        marketMomentumPressureCents,
        range,
        input.config,
      );
      quotes.push({
        playerId: value.player.playerId,
        currentPriceCents,
        previousPriceCents: value.player.previousPriceCents,
        priceChangeCents: currentPriceCents - value.player.previousPriceCents,
        fairPriceCents,
        seasonPointsPercentile: value.seasonPointsPercentile,
        recentFormPercentile: value.recentFormPercentile,
        pointsPerAppearancePercentile: value.pointsPerAppearancePercentile,
        performanceIndex: value.performanceIndex,
        adjustedPerformance,
        confidence,
        recentForm: value.player.recentForm,
        pointsPerAppearance: value.player.pointsPerAppearance,
        participationRate: value.player.participationRate,
        marketMomentum,
        marketMomentumPressureCents,
        formulaVersion: input.config.formulaVersion,
        inputHash: hash,
      });
    }
  }
  return quotes.sort((a, b) => a.playerId.localeCompare(b.playerId));
}

function buildInput(db: SqliteDatabase, tournamentId: string, asOfGameweekId: string, config: PricingConfig): PricingEngineInput {
  const asOf = db.prepare(`SELECT week_number AS weekNumber, status,
      COALESCE(ends_at, deadline_at) AS pricingCutoff
    FROM gameweeks WHERE id = ? AND tournament_id = ?`)
    .get(asOfGameweekId, tournamentId) as { weekNumber: number; status: string; pricingCutoff: string } | undefined;
  if (!asOf) throw new Error(`La jornada ${asOfGameweekId} no pertenece al torneo ${tournamentId}.`);
  if (asOf.status !== 'FINISHED') throw new Error('Los precios solo pueden calcularse después de cerrar la jornada.');

  const recentGameweeks = (db.prepare(`SELECT DISTINCT gw.id, gw.week_number AS weekNumber
    FROM gameweeks gw JOIN player_fantasy_points pfp ON pfp.gameweek_id = gw.id
    JOIN matches m ON m.id = pfp.match_id
    WHERE gw.tournament_id = ? AND gw.week_number <= ? AND m.score_status IN ('CONFIRMED', 'CORRECTED')
    ORDER BY gw.week_number DESC LIMIT ?`).all(tournamentId, asOf.weekNumber, config.recentWindowGameweeks) as
      Array<{ id: string; weekNumber: number }>).reverse();
  const recentIds = recentGameweeks.map(gameweek => gameweek.id);

  const rows = db.prepare(`SELECT tp.player_id AS playerId, p.position,
      tp.price_cents AS previousPriceCents, COALESCE(points.seasonPoints, 0) AS seasonPoints,
      COALESCE(stats.appearances, 0) AS appearances, COALESCE(eligible.eligibleMatches, 0) AS eligibleMatches
    FROM tournament_players tp JOIN players p ON p.id = tp.player_id
    LEFT JOIN (
      SELECT pfp.player_id AS playerId, SUM(pfp.total_points) AS seasonPoints
      FROM player_fantasy_points pfp JOIN gameweeks gw ON gw.id = pfp.gameweek_id
      JOIN matches m ON m.id = pfp.match_id
      WHERE gw.tournament_id = ? AND gw.week_number <= ? AND m.score_status IN ('CONFIRMED', 'CORRECTED')
      GROUP BY pfp.player_id
    ) points ON points.playerId = p.id
    LEFT JOIN (
      SELECT pms.player_id AS playerId,
        COUNT(DISTINCT CASE WHEN COALESCE(pms.minutes, 0) > 0 OR pms.starter = 1 OR pms.substitute_in = 1 THEN pms.match_id END) AS appearances
      FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id JOIN gameweeks gw ON gw.id = m.gameweek_id
      WHERE gw.tournament_id = ? AND gw.week_number <= ? AND m.score_status IN ('CONFIRMED', 'CORRECTED')
      GROUP BY pms.player_id
    ) stats ON stats.playerId = p.id
    LEFT JOIN (
      SELECT club.id AS clubId, COUNT(DISTINCT m.id) AS eligibleMatches
      FROM clubs club JOIN matches m ON m.home_club_id = club.id OR m.away_club_id = club.id
      JOIN gameweeks gw ON gw.id = m.gameweek_id
      WHERE gw.tournament_id = ? AND gw.week_number <= ? AND m.score_status IN ('CONFIRMED', 'CORRECTED')
      GROUP BY club.id
    ) eligible ON eligible.clubId = p.club_id
    WHERE tp.tournament_id = ? AND tp.active = 1 AND p.active = 1 ORDER BY tp.player_id`).all(
      tournamentId, asOf.weekNumber, tournamentId, asOf.weekNumber,
      tournamentId, asOf.weekNumber, tournamentId,
    ) as Array<{ playerId: string; position: PricingPosition; previousPriceCents: number; seasonPoints: number; appearances: number; eligibleMatches: number }>;

  const recentRows = recentIds.length ? db.prepare(`SELECT pfp.player_id AS playerId, pfp.gameweek_id AS gameweekId,
      SUM(pfp.total_points) AS points FROM player_fantasy_points pfp JOIN matches m ON m.id = pfp.match_id
    WHERE pfp.gameweek_id IN (${recentIds.map(() => '?').join(',')}) AND m.score_status IN ('CONFIRMED', 'CORRECTED')
    GROUP BY pfp.player_id, pfp.gameweek_id`).all(...recentIds) as Array<{ playerId: string; gameweekId: string; points: number }> : [];
  const recentByPlayer = new Map<string, Map<string, number>>();
  for (const row of recentRows) {
    if (!recentByPlayer.has(row.playerId)) recentByPlayer.set(row.playerId, new Map());
    recentByPlayer.get(row.playerId)?.set(row.gameweekId, Number(row.points));
  }
  const momentum = config.marketMomentumEnabled
    ? loadMarketMomentum(db, tournamentId, asOf.pricingCutoff, config.marketMomentumConfig).players
    : new Map<string, MarketMomentumInput>();
  return {
    tournamentId, asOfGameweekId, config,
    players: rows.map(row => ({
      playerId: row.playerId,
      position: row.position,
      seasonPoints: Number(row.seasonPoints),
      recentGameweekPoints: recentIds.map(id => recentByPlayer.get(row.playerId)?.get(id) ?? 0),
      appearances: Number(row.appearances),
      eligibleMatches: Number(row.eligibleMatches),
      previousPriceCents: Number(row.previousPriceCents),
      momentum: momentum.get(row.playerId),
    })),
  };
}

export function calculatePlayerPrices(
  db: SqliteDatabase,
  tournamentId: string,
  asOfGameweekId: string,
  config: PricingConfig = pricingConfigFromEnv(),
): PricingRunResult {
  const existing = db.prepare(`SELECT id, input_hash AS inputHash FROM pricing_runs
    WHERE tournament_id = ? AND as_of_gameweek_id = ? AND formula_version = ? AND status = 'COMPLETED'
    ORDER BY completed_at DESC LIMIT 1`).get(tournamentId, asOfGameweekId, config.formulaVersion) as
      { id: string; inputHash: string } | undefined;
  if (existing) return {
    runId: existing.id, tournamentId, asOfGameweekId, formulaVersion: config.formulaVersion,
    inputHash: existing.inputHash, updated: 0, bootstrap: false, idempotent: true, quotes: [],
  };

  const input = buildInput(db, tournamentId, asOfGameweekId, config);
  const bootstrap = !db.prepare(`SELECT 1 FROM pricing_runs
    WHERE tournament_id = ? AND formula_version = ? AND status = 'COMPLETED' LIMIT 1`).get(tournamentId, config.formulaVersion);
  const quotes = calculatePriceQuotes(input, { bootstrap });
  const hash = quotes[0]?.inputHash ?? pricingInputHash(input, bootstrap);
  const run = startPricingRun(db, {
    tournamentId, asOfGameweekId, formulaVersion: config.formulaVersion, config, inputHash: hash,
    inputSnapshotJson: createPricingInputSnapshot(input, bootstrap),
  });
  const inputs = new Map(input.players.map(player => [player.playerId, player]));
  let completion;
  try {
    completion = completePricingRun(db, {
      runId: run.id,
      prices: quotes.map(quote => ({
        playerId: quote.playerId,
        currentPriceCents: quote.currentPriceCents,
        fairPriceCents: quote.fairPriceCents,
        seasonPointsPercentile: quote.seasonPointsPercentile,
        recentFormPercentile: quote.recentFormPercentile,
        pointsPerAppearancePercentile: quote.pointsPerAppearancePercentile,
        performanceIndex: quote.performanceIndex,
        adjustedPerformance: quote.adjustedPerformance,
        confidence: quote.confidence,
        seasonPoints: inputs.get(quote.playerId)!.seasonPoints,
        recentForm: quote.recentForm,
        pointsPerAppearance: quote.pointsPerAppearance,
        participationRate: quote.participationRate,
        marketMomentum: quote.marketMomentum,
      })),
    });
  } catch (error) {
    failPricingRun(db, run.id);
    throw error;
  }
  return {
    runId: run.id, tournamentId, asOfGameweekId, formulaVersion: config.formulaVersion,
    inputHash: hash, updated: completion.applied ? completion.updatedPlayers : 0,
    bootstrap, idempotent: !completion.applied, quotes: completion.applied ? quotes : [],
  };
}
