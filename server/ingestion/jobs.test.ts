import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, seedGameweek, seedTournament, type SqliteDatabase } from '../db.js';
import { computeNextSyncDelayMs } from './jobs.js';

const databases: SqliteDatabase[] = [];
const NOW = Date.parse('2026-09-12T18:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

function testDatabase(): SqliteDatabase {
  const db = openDatabase({ filename: ':memory:' });
  databases.push(db);
  seedTournament(db, { id: 'apertura-2026', name: 'Apertura 2026' });
  return db;
}

function insertMatch(db: SqliteDatabase, id: string, gameweekId: string, startsAt: string, scoreStatus = 'PENDING') {
  db.prepare(`INSERT INTO matches
    (id, home_club_id, away_club_id, home_club_name, away_club_name, starts_at, home_score, away_score,
     created_at, updated_at, gameweek_id, score_status)
    VALUES (?, NULL, NULL, 'Home', 'Away', ?, NULL, NULL, ?, ?, ?, ?)`)
    .run(id, startsAt, new Date().toISOString(), new Date().toISOString(), gameweekId, scoreStatus);
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe('computeNextSyncDelayMs', () => {
  it('falls back to 24h when there is no active gameweek', () => {
    const db = testDatabase();
    expect(computeNextSyncDelayMs(db, NOW)).toBe(24 * HOUR);
  });

  it('falls back to 24h when the active gameweek has no matches yet', () => {
    const db = testDatabase();
    seedGameweek(db, { id: 'gw-1', tournamentId: 'apertura-2026', weekNumber: 1, name: 'J1',
      deadlineAt: '2026-09-12T01:00:00.000Z', status: 'OPEN' });
    expect(computeNextSyncDelayMs(db, NOW)).toBe(24 * HOUR);
  });

  it('targets 2h40m after kickoff for a match still missing a confirmed score', () => {
    const db = testDatabase();
    seedGameweek(db, { id: 'gw-1', tournamentId: 'apertura-2026', weekNumber: 1, name: 'J1',
      deadlineAt: '2026-09-12T01:00:00.000Z', status: 'OPEN' });
    const kickoff = NOW + 2 * HOUR; // still upcoming
    insertMatch(db, 'm1', 'gw-1', new Date(kickoff).toISOString(), 'PENDING');
    const expected = kickoff + 130 * MIN + 30 * MIN; // assumed duration + requested 30-minute buffer
    expect(computeNextSyncDelayMs(db, NOW)).toBe(expected - NOW);
  });

  it('schedules almost immediately when a match’s post-match sync time has already passed', () => {
    const db = testDatabase();
    seedGameweek(db, { id: 'gw-1', tournamentId: 'apertura-2026', weekNumber: 1, name: 'J1',
      deadlineAt: '2026-09-12T01:00:00.000Z', status: 'OPEN' });
    insertMatch(db, 'm1', 'gw-1', new Date(NOW - 24 * HOUR).toISOString(), 'PENDING'); // played yesterday, no score yet
    expect(computeNextSyncDelayMs(db, NOW)).toBe(60 * 1000); // clamped to the 1-minute floor, not overdue-negative
  });

  it('skips matches whose score is already CONFIRMED or CORRECTED', () => {
    const db = testDatabase();
    seedGameweek(db, { id: 'gw-1', tournamentId: 'apertura-2026', weekNumber: 1, name: 'J1',
      deadlineAt: '2026-09-12T01:00:00.000Z', status: 'OPEN' });
    insertMatch(db, 'm1', 'gw-1', new Date(NOW - 5 * HOUR).toISOString(), 'CONFIRMED');
    // Only the end-of-gameweek safety net should remain as a candidate.
    const safetyNetAt = (NOW - 5 * HOUR) + (130 + 30 + 150) * MIN;
    expect(computeNextSyncDelayMs(db, NOW)).toBe(safetyNetAt - NOW);
  });

  it('falls back to 24h once every match is confirmed and the safety-net sync already ran', () => {
    const db = testDatabase();
    seedGameweek(db, { id: 'gw-1', tournamentId: 'apertura-2026', weekNumber: 1, name: 'J1',
      deadlineAt: '2026-09-12T01:00:00.000Z', status: 'OPEN' });
    insertMatch(db, 'm1', 'gw-1', new Date(NOW - 24 * HOUR).toISOString(), 'CONFIRMED');
    db.prepare(`INSERT INTO sync_runs (run_id, source, job, started_at, finished_at, status,
      records_found, records_created, records_updated, conflicts, errors_json)
      VALUES ('r1', 'LPF', 'syncResults', ?, ?, 'OK', 0, 0, 0, 0, '[]')`)
      .run(new Date(NOW).toISOString(), new Date(NOW).toISOString()); // sync already ran after the safety-net time
    expect(computeNextSyncDelayMs(db, NOW)).toBe(24 * HOUR);
  });

  it('adds one end-of-gameweek safety sync anchored to the latest kickoff among several matches', () => {
    const db = testDatabase();
    seedGameweek(db, { id: 'gw-1', tournamentId: 'apertura-2026', weekNumber: 1, name: 'J1',
      deadlineAt: '2026-09-12T01:00:00.000Z', status: 'OPEN' });
    insertMatch(db, 'm1', 'gw-1', new Date(NOW - 10 * HOUR).toISOString(), 'CONFIRMED');
    const lastKickoff = NOW + 3 * HOUR;
    insertMatch(db, 'm2', 'gw-1', new Date(lastKickoff).toISOString(), 'PENDING');
    // The earliest candidate should be m2's own post-match sync, not the safety net.
    const m2Sync = lastKickoff + 130 * MIN + 30 * MIN;
    expect(computeNextSyncDelayMs(db, NOW)).toBe(m2Sync - NOW);
  });
});
