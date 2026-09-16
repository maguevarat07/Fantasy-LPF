import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, seedGameweek, seedTournament, type SqliteDatabase } from './db.js';
import { recalculateGameweek } from './scoring.js';
import { recalculatePlayerPrices } from './pricing.js';

const databases: SqliteDatabase[] = [];

function testDatabase(): SqliteDatabase {
  const db = openDatabase({ filename: ':memory:' });
  databases.push(db);
  seedTournament(db, { id: 'apertura-2026', name: 'Apertura 2026' });
  seedGameweek(db, { id: 'gw-1', tournamentId: 'apertura-2026', weekNumber: 1,
    name: 'Jornada 1', deadlineAt: '2020-01-01T00:00:00.000Z', status: 'FINISHED' });
  db.prepare('INSERT INTO clubs (id, name, code, active, normalized_name) VALUES (?, ?, ?, 1, ?)').run('club-1', 'Club 1', 'C1', 'club 1');
  db.prepare('INSERT INTO clubs (id, name, code, active, normalized_name) VALUES (?, ?, ?, 1, ?)').run('club-2', 'Club 2', 'C2', 'club 2');
  const insertPlayer = db.prepare(`INSERT INTO players
    (id, club_id, name, position, price_cents, status, active, updated_at) VALUES (?, ?, ?, ?, 450000000, 'ACTIVE', 1, ?)`);
  insertPlayer.run('fwd-star', 'club-1', 'Estrella FWD', 'FWD', new Date().toISOString());
  insertPlayer.run('fwd-bench', 'club-2', 'Suplente FWD', 'FWD', new Date().toISOString());
  const insertTournamentPlayer = db.prepare(`INSERT INTO tournament_players
    (tournament_id, player_id, price_cents, active) VALUES ('apertura-2026', ?, 450000000, 1)`);
  insertTournamentPlayer.run('fwd-star');
  insertTournamentPlayer.run('fwd-bench');
  return db;
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe('recalculatePlayerPrices', () => {
  it('valora más caro al jugador con más puntos anotados que a uno sin minutos', () => {
    const db = testDatabase();
    db.prepare(`INSERT INTO matches
      (id, home_club_id, away_club_id, home_club_name, away_club_name, starts_at, home_score, away_score,
       created_at, updated_at, gameweek_id, score_status)
      VALUES ('match-1', 'club-1', 'club-2', 'Club 1', 'Club 2', '2020-01-01T00:00:00.000Z', 3, 0,
       ?, ?, 'gw-1', 'CONFIRMED')`).run(new Date().toISOString(), new Date().toISOString());
    db.prepare(`INSERT INTO player_match_stats
      (player_id, match_id, source, starter, substitute_in, minutes, goals, assists, yellow_cards, red_cards,
       own_goals, saves, source_url, external_id, updated_at)
      VALUES ('fwd-star', 'match-1', 'TEST', 1, 0, 90, 3, 0, 0, 0, 0, 0, 'http://test', 'ext-1', ?)`)
      .run(new Date().toISOString());

    recalculateGameweek(db, 'gw-1');
    const { updated } = recalculatePlayerPrices(db);
    expect(updated).toBe(2);

    const prices = db.prepare(`SELECT player_id AS playerId, price_cents AS priceCents
      FROM tournament_players WHERE tournament_id = 'apertura-2026'`).all() as Array<{ playerId: string; priceCents: number }>;
    const star = prices.find(row => row.playerId === 'fwd-star')!;
    const bench = prices.find(row => row.playerId === 'fwd-bench')!;

    expect(star.priceCents).toBeGreaterThan(bench.priceCents);
    expect(bench.priceCents).toBeGreaterThanOrEqual(500_000_000);
    expect(bench.priceCents % 10_000_000).toBe(0);
  });
});
