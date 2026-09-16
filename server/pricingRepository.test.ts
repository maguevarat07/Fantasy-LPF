import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, seedGameweek, seedTournament, type SqliteDatabase } from './db.js';
import {
  completePricingRun,
  failPricingRun,
  getPricingRun,
  startPricingRun,
  type PersistedPlayerPrice,
} from './pricingRepository.js';

const databases: SqliteDatabase[] = [];

function testDatabase(): SqliteDatabase {
  const db = openDatabase({ filename: ':memory:' });
  databases.push(db);
  seedTournament(db, { id: 'apertura-2026', name: 'Apertura 2026' });
  seedGameweek(db, {
    id: 'gw-1', tournamentId: 'apertura-2026', weekNumber: 1,
    name: 'Jornada 1', deadlineAt: '2026-01-01T00:00:00.000Z', status: 'FINISHED',
  });
  seedGameweek(db, {
    id: 'gw-2', tournamentId: 'apertura-2026', weekNumber: 2,
    name: 'Jornada 2', deadlineAt: '2026-01-08T00:00:00.000Z', status: 'FINISHED',
  });
  db.prepare(`INSERT INTO clubs (id, name, code, active, normalized_name)
    VALUES ('club-1', 'Club 1', 'C1', 1, 'club 1')`).run();
  db.prepare(`INSERT INTO players
    (id, club_id, name, position, price_cents, status, active, updated_at)
    VALUES ('player-1', 'club-1', 'Jugador 1', 'MID', 450000000, 'ACTIVE', 1, ?)`)
    .run('2026-01-01T00:00:00.000Z');
  db.prepare(`INSERT INTO tournament_players (tournament_id, player_id, price_cents, active)
    VALUES ('apertura-2026', 'player-1', 450000000, 1)`).run();
  return db;
}

function quote(playerId = 'player-1', currentPriceCents = 600_000_000): PersistedPlayerPrice {
  return {
    playerId,
    currentPriceCents,
    fairPriceCents: currentPriceCents,
    seasonPointsPercentile: 0.8,
    recentFormPercentile: 0.7,
    pointsPerAppearancePercentile: 0.75,
    performanceIndex: 0.76,
    adjustedPerformance: 0.7,
    confidence: 0.75,
    seasonPoints: 24,
    recentForm: 5.5,
    pointsPerAppearance: 4,
    participationRate: 0.8,
  };
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe('migración económica', () => {
  it('crea las columnas e índices y conserva el precio vigente como precio inicial', () => {
    const db = testDatabase();
    const current = db.prepare(`SELECT price_cents AS currentPrice, initial_price_cents AS initialPrice,
      fair_price_cents AS fairPrice, pricing_status AS pricingStatus
      FROM tournament_players WHERE tournament_id = 'apertura-2026' AND player_id = 'player-1'`)
      .get() as { currentPrice: number; initialPrice: number; fairPrice: number | null; pricingStatus: string };

    expect(current).toEqual({
      currentPrice: 450_000_000,
      initialPrice: 450_000_000,
      fairPrice: null,
      pricingStatus: 'LEGACY',
    });
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'
      AND name = 'player_price_history_period_version_uidx'`).get()).toBeDefined();
  });
});

describe('pricing repository', () => {
  it('guarda precio vigente e historial en una sola transacción', () => {
    const db = testDatabase();
    const run = startPricingRun(db, {
      id: 'run-1', tournamentId: 'apertura-2026', asOfGameweekId: 'gw-1',
      formulaVersion: 'lpf-price-v2.0.0', config: { gamma: 2 }, inputHash: 'hash-1',
    });

    expect(completePricingRun(db, { runId: run.id, prices: [quote()] }))
      .toEqual({ applied: true, updatedPlayers: 1 });
    const current = db.prepare(`SELECT price_cents AS price, initial_price_cents AS initialPrice,
      previous_price_cents AS previousPrice, fair_price_cents AS fairPrice,
      last_change_cents AS change, last_calculated_gameweek_id AS gameweek,
      pricing_status AS status, pricing_version AS version
      FROM tournament_players WHERE tournament_id = 'apertura-2026' AND player_id = 'player-1'`).get();
    expect(current).toEqual({
      price: 600_000_000, initialPrice: 450_000_000, previousPrice: 450_000_000,
      fairPrice: 600_000_000, change: 150_000_000, gameweek: 'gw-1',
      status: 'CURRENT', version: 'lpf-price-v2.0.0',
    });
    const history = db.prepare(`SELECT previous_price_cents AS oldPrice, current_price_cents AS newPrice,
      change_cents AS change, market_momentum AS momentum FROM player_price_history`).get();
    expect(history).toEqual({ oldPrice: 450_000_000, newPrice: 600_000_000, change: 150_000_000, momentum: 0 });
    expect(getPricingRun(db, run.id)?.status).toBe('COMPLETED');
  });

  it('es idempotente para la misma entrada y bloquea otra entrada en la misma jornada/versión', () => {
    const db = testDatabase();
    const input = {
      id: 'run-1', tournamentId: 'apertura-2026', asOfGameweekId: 'gw-1',
      formulaVersion: 'lpf-price-v2.0.0', config: { gamma: 2 }, inputHash: 'hash-1',
    };
    const run = startPricingRun(db, input);
    completePricingRun(db, { runId: run.id, prices: [quote()] });

    expect(startPricingRun(db, { ...input, id: 'ignored' }).id).toBe(run.id);
    expect(completePricingRun(db, { runId: run.id, prices: [quote()] }))
      .toEqual({ applied: false, updatedPlayers: 1 });
    expect(() => startPricingRun(db, { ...input, id: 'run-2', inputHash: 'different' }))
      .toThrow(/otra entrada/);
    expect((db.prepare('SELECT COUNT(*) AS total FROM player_price_history').get() as { total: number }).total).toBe(1);
  });

  it('mantiene una serie histórica entre jornadas', () => {
    const db = testDatabase();
    const first = startPricingRun(db, {
      id: 'run-1', tournamentId: 'apertura-2026', asOfGameweekId: 'gw-1',
      formulaVersion: 'lpf-price-v2.0.0', config: {}, inputHash: 'hash-1',
    });
    completePricingRun(db, { runId: first.id, prices: [quote('player-1', 600_000_000)] });
    const second = startPricingRun(db, {
      id: 'run-2', tournamentId: 'apertura-2026', asOfGameweekId: 'gw-2',
      formulaVersion: 'lpf-price-v2.0.0', config: {}, inputHash: 'hash-2',
    });
    completePricingRun(db, { runId: second.id, prices: [quote('player-1', 650_000_000)] });

    const history = db.prepare(`SELECT gameweek_id AS gameweek, previous_price_cents AS oldPrice,
      current_price_cents AS newPrice FROM player_price_history ORDER BY gameweek_id`).all();
    expect(history).toEqual([
      { gameweek: 'gw-1', oldPrice: 450_000_000, newPrice: 600_000_000 },
      { gameweek: 'gw-2', oldPrice: 600_000_000, newPrice: 650_000_000 },
    ]);
  });

  it('impone un historial único por jugador, torneo, jornada y versión', () => {
    const db = testDatabase();
    const first = startPricingRun(db, {
      id: 'run-1', tournamentId: 'apertura-2026', asOfGameweekId: 'gw-1',
      formulaVersion: 'lpf-price-v2.0.0', config: {}, inputHash: 'hash-1',
    });
    completePricingRun(db, { runId: first.id, prices: [quote()] });
    db.prepare(`INSERT INTO pricing_runs
      (id, tournament_id, as_of_gameweek_id, formula_version, config_json, input_hash, status, created_at)
      VALUES ('run-2', 'apertura-2026', 'gw-1', 'lpf-price-v2.0.0', '{}', 'hash-2', 'RUNNING', ?)`)
      .run('2026-01-09T00:00:00.000Z');

    expect(() => completePricingRun(db, { runId: 'run-2', prices: [quote('player-1', 700_000_000)] }))
      .toThrow(/UNIQUE constraint failed/);
    expect((db.prepare('SELECT COUNT(*) AS total FROM player_price_history').get() as { total: number }).total).toBe(1);
    expect((db.prepare(`SELECT price_cents AS price FROM tournament_players WHERE player_id = 'player-1'`)
      .get() as { price: number }).price).toBe(600_000_000);
  });

  it('revierte todo el snapshot cuando un jugador no pertenece al torneo', () => {
    const db = testDatabase();
    const run = startPricingRun(db, {
      id: 'run-1', tournamentId: 'apertura-2026', asOfGameweekId: 'gw-1',
      formulaVersion: 'lpf-price-v2.0.0', config: {}, inputHash: 'hash-1',
    });

    expect(() => completePricingRun(db, {
      runId: run.id,
      prices: [quote('player-1', 600_000_000), quote('missing-player', 700_000_000)],
    })).toThrow(/no pertenece/);
    expect((db.prepare(`SELECT price_cents AS price FROM tournament_players
      WHERE player_id = 'player-1'`).get() as { price: number }).price).toBe(450_000_000);
    expect((db.prepare('SELECT COUNT(*) AS total FROM player_price_history').get() as { total: number }).total).toBe(0);
    expect(getPricingRun(db, run.id)?.status).toBe('RUNNING');
    failPricingRun(db, run.id);
    expect(getPricingRun(db, run.id)?.status).toBe('FAILED');
  });
});

describe('ownership', () => {
  it('conserva purchasePrice y purchaseGameweek cuando cambia el precio del torneo', () => {
    const db = testDatabase();
    db.prepare(`INSERT INTO users (id, email, username, password_hash, created_at, updated_at)
      VALUES ('user-1', 'owner@example.com', 'owner', 'hash', ?, ?)`)
      .run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    db.prepare(`INSERT INTO fantasy_teams
      (id, user_id, tournament_id, name, formation, bank_cents, created_at, updated_at)
      VALUES ('team-1', 'user-1', 'apertura-2026', 'Equipo', '4-4-2', 5000000000, ?, ?)`)
      .run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    db.prepare(`INSERT INTO squad_players
      (fantasy_team_id, player_id, purchase_price_cents, acquired_at, purchase_gameweek_id)
      VALUES ('team-1', 'player-1', 450000000, ?, 'gw-1')`)
      .run('2026-01-01T00:00:00.000Z');
    db.prepare(`UPDATE tournament_players SET price_cents = 650000000
      WHERE tournament_id = 'apertura-2026' AND player_id = 'player-1'`).run();

    const ownership = db.prepare(`SELECT purchase_price_cents AS purchasePrice,
      purchase_gameweek_id AS purchaseGameweek FROM squad_players`).get();
    expect(ownership).toEqual({ purchasePrice: 450_000_000, purchaseGameweek: 'gw-1' });
  });
});
