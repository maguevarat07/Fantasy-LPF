import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from './db.js';
import type {
  CanonicalDataRepository,
  CanonicalDataTransaction,
} from './ingestion/repository.js';
import type {
  NormalizedClub,
  NormalizedMatch,
  NormalizedPlayer,
  NormalizedPlayerStat,
  SourceObservation,
  SyncRunRecord,
} from './ingestion/types.js';
import { normalizeIdentity } from './ingestion/normalization.js';

type UpsertResult = 'created' | 'updated' | 'unchanged';

function timestamp(): string {
  return new Date().toISOString();
}

function makeClubCode(db: SqliteDatabase, normalizedName: string): string {
  const stem = normalizedName.replace(/[^a-z0-9]/gi, '').slice(0, 5).toUpperCase() || 'CLUB';
  for (let index = 0; index < 1000; index += 1) {
    const code = index === 0 ? stem : `${stem}${index}`;
    if (!db.prepare('SELECT 1 FROM clubs WHERE code = ?').get(code)) return code;
  }
  return randomUUID().slice(0, 8).toUpperCase();
}

function getClubByNormalizedName(db: SqliteDatabase, normalizedName: string | null): string | null {
  if (!normalizedName) return null;
  const row = db.prepare('SELECT id FROM clubs WHERE normalized_name = ?').get(normalizedName) as { id: string } | undefined;
  return row?.id ?? null;
}

function upsertClub(db: SqliteDatabase, value: NormalizedClub): UpsertResult {
  const linked = db.prepare(`SELECT c.* FROM club_external_ids x JOIN clubs c ON c.id = x.club_id
    WHERE x.source = ? AND x.external_id = ?`).get(value.external.source, value.external.externalId) as Record<string, unknown> | undefined;
  let clubId = linked?.id as string | undefined;
  let result: UpsertResult = 'unchanged';
  if (!clubId) {
    const identity = db.prepare('SELECT id FROM clubs WHERE normalized_name = ?').get(value.normalizedName) as { id: string } | undefined;
    clubId = identity?.id ?? randomUUID();
    if (!identity) {
      db.prepare(`INSERT INTO clubs (id, name, code, active, normalized_name) VALUES (?, ?, ?, 1, ?)`)
        .run(clubId, value.name, makeClubCode(db, value.normalizedName), value.normalizedName);
      result = 'created';
    }
    db.prepare(`INSERT INTO club_external_ids
      (club_id, source, external_id, source_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(clubId, value.external.source, value.external.externalId, value.external.sourceUrl, timestamp(), timestamp());
  }
  if (linked && (linked.name !== value.name || linked.normalized_name !== value.normalizedName)) {
    db.prepare('UPDATE clubs SET name = ?, normalized_name = ? WHERE id = ?').run(value.name, value.normalizedName, clubId);
    result = 'updated';
  }
  db.prepare(`UPDATE club_external_ids SET source_url = ?, updated_at = ?
    WHERE source = ? AND external_id = ?`)
    .run(value.external.sourceUrl, timestamp(), value.external.source, value.external.externalId);
  return result;
}

function upsertPlayer(db: SqliteDatabase, value: NormalizedPlayer): UpsertResult {
  const linked = db.prepare(`SELECT p.* FROM player_external_ids x JOIN players p ON p.id = x.player_id
    WHERE x.source = ? AND x.external_id = ?`).get(value.external.source, value.external.externalId) as Record<string, unknown> | undefined;
  const clubId = getClubByNormalizedName(db, value.normalizedClubName);
  // Unresolved rows remain in source_observations for review. They cannot enter
  // the selectable canonical player table without a verified club and position.
  if (!clubId || !value.position) return 'unchanged';
  let playerId = linked?.id as string | undefined;
  const previousClubId = linked?.club_id == null ? null : String(linked.club_id);
  let result: UpsertResult = 'unchanged';
  if (!playerId) {
    const identity = db.prepare(`SELECT id FROM players WHERE normalized_name = ?
      AND club_id IS ? AND (date_of_birth IS ? OR date_of_birth = ?)`)
      .get(value.normalizedName, clubId, value.dateOfBirth, value.dateOfBirth) as { id: string } | undefined;
    playerId = identity?.id ?? randomUUID();
    if (!identity) {
      db.prepare(`INSERT INTO players
        (id, club_id, name, position, status, active, updated_at, display_name, normalized_name,
          date_of_birth, nationality, shirt_number, image_url)
        VALUES (?, ?, ?, ?, 'ACTIVE', 1, ?, ?, ?, ?, ?, ?, ?)`)
        .run(playerId, clubId, value.fullName, value.position, timestamp(), value.displayName,
          value.normalizedName, value.dateOfBirth, value.nationality, value.shirtNumber, value.imageUrl);
      result = 'created';
    }
    db.prepare(`INSERT INTO player_external_ids
      (player_id, source, external_id, source_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(playerId, value.external.source, value.external.externalId, value.external.sourceUrl, timestamp(), timestamp());
    if (!identity) {
      db.prepare(`INSERT INTO player_club_history
        (id, player_id, from_club_id, to_club_id, source, source_url, detected_at)
        VALUES (?, ?, NULL, ?, ?, ?, ?)`)
        .run(randomUUID(), playerId, clubId, value.external.source, value.external.sourceUrl, timestamp());
    }
  }
  const changed = linked && (
    linked.name !== value.fullName || linked.display_name !== value.displayName || linked.club_id !== clubId ||
    linked.position !== value.position || linked.date_of_birth !== value.dateOfBirth ||
    linked.nationality !== value.nationality || linked.shirt_number !== value.shirtNumber || linked.image_url !== value.imageUrl
  );
  if (changed) {
    if (previousClubId !== clubId) {
      db.prepare(`UPDATE player_club_history SET ended_at = ?
        WHERE player_id = ? AND source = ? AND ended_at IS NULL`)
        .run(timestamp(), playerId, value.external.source);
      db.prepare(`INSERT INTO player_club_history
        (id, player_id, from_club_id, to_club_id, source, source_url, detected_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), playerId, previousClubId, clubId, value.external.source, value.external.sourceUrl, timestamp());
    }
    db.prepare(`UPDATE players SET club_id = ?, name = ?, display_name = ?, normalized_name = ?, position = ?,
      date_of_birth = ?, nationality = ?, shirt_number = ?, image_url = ?, updated_at = ? WHERE id = ?`)
      .run(clubId, value.fullName, value.displayName, value.normalizedName, value.position,
        value.dateOfBirth, value.nationality, value.shirtNumber, value.imageUrl, timestamp(), playerId);
    result = 'updated';
  }
  if (!linked) {
    db.prepare(`UPDATE players SET image_url = COALESCE(?, image_url), nationality = COALESCE(?, nationality),
      shirt_number = COALESCE(?, shirt_number), updated_at = ? WHERE id = ?`)
      .run(value.imageUrl, value.nationality, value.shirtNumber, timestamp(), playerId);
  }
  db.prepare(`UPDATE player_external_ids SET source_url = ?, updated_at = ?
    WHERE source = ? AND external_id = ?`)
    .run(value.external.sourceUrl, timestamp(), value.external.source, value.external.externalId);
  return result;
}

function upsertMatch(db: SqliteDatabase, value: NormalizedMatch): UpsertResult {
  db.prepare(`INSERT INTO gameweeks (id, tournament_id, week_number, name, starts_at, deadline_at, ends_at, status)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT(id) DO UPDATE SET status = excluded.status`)
    .run(value.gameweekId, value.tournamentId, value.gameweekNumber, value.round ?? `Jornada ${value.gameweekNumber}`,
      value.startsAt, value.deadlineAt, value.gameweekStatus);
  const linked = db.prepare(`SELECT m.* FROM match_external_ids x JOIN matches m ON m.id = x.match_id
    WHERE x.source = ? AND x.external_id = ?`).get(value.external.source, value.external.externalId) as Record<string, unknown> | undefined;
  let matchId = linked?.id as string | undefined;
  let result: UpsertResult = 'unchanged';
  if (!matchId) {
    matchId = randomUUID();
    db.prepare(`INSERT INTO matches
      (id, home_club_id, away_club_id, home_club_name, away_club_name, starts_at,
       home_score, away_score, round, created_at, updated_at, gameweek_id, score_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(matchId, getClubByNormalizedName(db, normalizeIdentity(value.homeClub)), getClubByNormalizedName(db, normalizeIdentity(value.awayClub)),
        value.homeClub, value.awayClub, value.startsAt, value.homeScore, value.awayScore, value.round, timestamp(), timestamp(),
        value.gameweekId, value.scoreStatus);
    db.prepare(`INSERT INTO match_external_ids
      (match_id, source, external_id, source_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(matchId, value.external.source, value.external.externalId, value.external.sourceUrl, timestamp(), timestamp());
    result = 'created';
  } else if (linked && (
    linked.home_club_name !== value.homeClub || linked.away_club_name !== value.awayClub ||
    linked.starts_at !== value.startsAt || linked.home_score !== value.homeScore ||
    linked.away_score !== value.awayScore || linked.round !== value.round || linked.gameweek_id !== value.gameweekId ||
    linked.score_status !== value.scoreStatus
  )) {
    db.prepare(`UPDATE matches SET home_club_id = ?, away_club_id = ?, home_club_name = ?, away_club_name = ?,
      starts_at = ?, home_score = ?, away_score = ?, round = ?, updated_at = ?, gameweek_id = ?, score_status = ? WHERE id = ?`)
      .run(getClubByNormalizedName(db, normalizeIdentity(value.homeClub)), getClubByNormalizedName(db, normalizeIdentity(value.awayClub)),
        value.homeClub, value.awayClub, value.startsAt, value.homeScore, value.awayScore, value.round, timestamp(),
        value.gameweekId, value.scoreStatus, matchId);
    result = 'updated';
  }
  db.prepare(`UPDATE match_external_ids SET source_url = ?, updated_at = ? WHERE source = ? AND external_id = ?`)
    .run(value.external.sourceUrl, timestamp(), value.external.source, value.external.externalId);
  // Recompute from the current schedule so postponing the earliest fixture can
  // move the deadline forward instead of preserving a stale historical value.
  db.prepare(`UPDATE gameweeks SET starts_at = (
      SELECT MIN(starts_at) FROM matches WHERE gameweek_id = ? AND starts_at IS NOT NULL
    ), deadline_at = (
      SELECT MIN(starts_at) FROM matches WHERE gameweek_id = ? AND starts_at IS NOT NULL
    ) WHERE id = ?`).run(value.gameweekId, value.gameweekId, value.gameweekId);
  return result;
}

function upsertPlayerStat(db: SqliteDatabase, value: NormalizedPlayerStat): UpsertResult {
  const player = db.prepare('SELECT player_id AS id FROM player_external_ids WHERE source = ? AND external_id = ?')
    .get(value.external.source, value.playerExternalId) as { id: string } | undefined;
  const match = db.prepare('SELECT match_id AS id FROM match_external_ids WHERE source = ? AND external_id = ?')
    .get(value.external.source, value.matchExternalId) as { id: string } | undefined;
  if (!player || !match) return 'unchanged';
  const previous = db.prepare('SELECT * FROM player_match_stats WHERE player_id = ? AND match_id = ?')
    .get(player.id, match.id) as Record<string, unknown> | undefined;
  db.prepare(`INSERT INTO player_match_stats
    (player_id, match_id, source, starter, substitute_in, minutes, goals, assists, yellow_cards,
      red_cards, own_goals, saves, source_url, external_id, updated_at, club_id, assist_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(player_id, match_id) DO UPDATE SET source = excluded.source, starter = excluded.starter,
      substitute_in = excluded.substitute_in, minutes = excluded.minutes, goals = excluded.goals,
      assists = excluded.assists, yellow_cards = excluded.yellow_cards, red_cards = excluded.red_cards,
      own_goals = excluded.own_goals, saves = excluded.saves, source_url = excluded.source_url,
      external_id = excluded.external_id, updated_at = excluded.updated_at, club_id = excluded.club_id,
      assist_status = excluded.assist_status`)
    .run(player.id, match.id, value.external.source, value.starter === null ? null : Number(value.starter),
      value.substituteIn === null ? null : Number(value.substituteIn), value.minutes, value.goals, value.assists,
      value.yellowCards, value.redCards, value.ownGoals, value.saves, value.external.sourceUrl,
      value.external.externalId, timestamp(), value.clubName ? getClubByNormalizedName(db, normalizeIdentity(value.clubName)) : null,
      value.assistStatus ?? 'PENDING');
  if (!previous) return 'created';
  const comparable = [value.minutes, value.goals, value.assists, value.yellowCards, value.redCards, value.ownGoals, value.saves];
  const old = ['minutes', 'goals', 'assists', 'yellow_cards', 'red_cards', 'own_goals', 'saves'].map(key => previous[key]);
  return comparable.some((entry, index) => entry !== old[index]) ? 'updated' : 'unchanged';
}

function upsertObservation(db: SqliteDatabase, value: SourceObservation): 'created' | 'unchanged' {
  const result = db.prepare(`INSERT OR IGNORE INTO source_observations
    (id, source, entity_type, external_entity_id, source_url, parser_version, observed_at, content_hash, value_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), value.source, value.entityType, value.externalEntityId, value.sourceUrl,
      value.parserVersion, value.observedAt, value.contentHash, JSON.stringify(value.value));
  return result.changes === 1 ? 'created' : 'unchanged';
}

export function createCanonicalDataRepository(db: SqliteDatabase): CanonicalDataRepository {
  const tx: CanonicalDataTransaction = {
    upsertClub: async value => upsertClub(db, value),
    upsertPlayer: async value => upsertPlayer(db, value),
    upsertMatch: async value => upsertMatch(db, value),
    upsertPlayerStat: async value => upsertPlayerStat(db, value),
    upsertObservation: async value => upsertObservation(db, value),
  };
  return {
    transaction: async work => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await work(tx);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        if (db.inTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
    recordSyncRun: async run => {
      db.prepare(`INSERT INTO sync_runs
        (run_id, source, job, started_at, finished_at, status, records_found, records_created,
          records_updated, conflicts, errors_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET finished_at = excluded.finished_at, status = excluded.status,
          records_found = excluded.records_found, records_created = excluded.records_created,
          records_updated = excluded.records_updated, conflicts = excluded.conflicts, errors_json = excluded.errors_json`)
        .run(run.runId, run.source, run.job, run.startedAt, run.finishedAt, run.status, run.recordsFound,
          run.recordsCreated, run.recordsUpdated, run.conflicts, JSON.stringify(run.errors));
    },
  };
}

export const canonicalDataRepository = createCanonicalDataRepository;
