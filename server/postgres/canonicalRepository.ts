import { randomUUID } from 'node:crypto';
import type { CanonicalDataRepository, CanonicalDataTransaction } from '../ingestion/repository.js';
import type {
  NormalizedClub, NormalizedMatch, NormalizedPlayer, NormalizedPlayerStat,
  SourceObservation, SyncRunRecord,
} from '../ingestion/types.js';
import { normalizeIdentity } from '../ingestion/normalization.js';
import type { PostgresDatabase, PostgresExecutor } from './client.js';

type Result = 'created' | 'updated' | 'unchanged';
type Row = Record<string, unknown>;
const now = () => new Date().toISOString();

async function clubIdByName(db: PostgresExecutor, name: string | null): Promise<string | null> {
  if (!name) return null;
  const row = await db.maybeOne<{ id: string }>('select id from clubs where normalized_name = $1', [name]);
  return row?.id ?? null;
}

async function nextClubCode(db: PostgresExecutor, normalizedName: string): Promise<string> {
  const stem = normalizedName.replace(/[^a-z0-9]/gi, '').slice(0, 5).toUpperCase() || 'CLUB';
  for (let index = 0; index < 1000; index += 1) {
    const code = index === 0 ? stem : `${stem}${index}`;
    if (!await db.maybeOne('select 1 from clubs where code = $1', [code])) return code;
  }
  return randomUUID().slice(0, 8).toUpperCase();
}

async function upsertClub(db: PostgresExecutor, value: NormalizedClub): Promise<Result> {
  const linked = await db.maybeOne<Row>(`select c.* from club_external_ids x join clubs c on c.id=x.club_id
    where x.source=$1 and x.external_id=$2`, [value.external.source, value.external.externalId]);
  let clubId = linked?.id ? String(linked.id) : undefined;
  let result: Result = 'unchanged';
  if (!clubId) {
    const identity = await db.maybeOne<{ id: string }>('select id from clubs where normalized_name=$1', [value.normalizedName]);
    clubId = identity?.id ?? randomUUID();
    if (!identity) {
      await db.execute('insert into clubs(id,name,code,active,normalized_name) values($1,$2,$3,true,$4)',
        [clubId, value.name, await nextClubCode(db, value.normalizedName), value.normalizedName]);
      result = 'created';
    }
    await db.execute(`insert into club_external_ids(club_id,source,external_id,source_url,created_at,updated_at)
      values($1,$2,$3,$4,$5,$5) on conflict(source,external_id) do update
      set club_id=excluded.club_id,source_url=excluded.source_url,updated_at=excluded.updated_at`,
      [clubId, value.external.source, value.external.externalId, value.external.sourceUrl, now()]);
  }
  if (linked && (linked.name !== value.name || linked.normalized_name !== value.normalizedName)) {
    await db.execute('update clubs set name=$1,normalized_name=$2 where id=$3', [value.name, value.normalizedName, clubId]);
    result = 'updated';
  }
  await db.execute('update club_external_ids set source_url=$1,updated_at=$2 where source=$3 and external_id=$4',
    [value.external.sourceUrl, now(), value.external.source, value.external.externalId]);
  return result;
}

async function upsertPlayer(db: PostgresExecutor, value: NormalizedPlayer): Promise<Result> {
  const linked = await db.maybeOne<Row>(`select p.* from player_external_ids x join players p on p.id=x.player_id
    where x.source=$1 and x.external_id=$2`, [value.external.source, value.external.externalId]);
  const clubId = await clubIdByName(db, value.normalizedClubName);
  if (!clubId || !value.position) return 'unchanged';
  let playerId = linked?.id ? String(linked.id) : undefined;
  let result: Result = 'unchanged';
  const previousClubId = linked?.club_id == null ? null : String(linked.club_id);
  if (!playerId) {
    const identity = await db.maybeOne<{ id: string }>(`select id from players where normalized_name=$1
      and club_id is not distinct from $2 and date_of_birth is not distinct from $3::date`,
      [value.normalizedName, clubId, value.dateOfBirth]);
    playerId = identity?.id ?? randomUUID();
    if (!identity) {
      await db.execute(`insert into players(id,club_id,name,position,status,active,updated_at,display_name,
        normalized_name,date_of_birth,nationality,shirt_number,image_url)
        values($1,$2,$3,$4,'ACTIVE',true,$5,$6,$7,$8,$9,$10,$11)`,
      [playerId, clubId, value.fullName, value.position, now(), value.displayName, value.normalizedName,
        value.dateOfBirth, value.nationality, value.shirtNumber, value.imageUrl]);
      result = 'created';
      await db.execute(`insert into player_club_history(id,player_id,from_club_id,to_club_id,source,source_url,detected_at)
        values($1,$2,null,$3,$4,$5,$6)`,
      [randomUUID(), playerId, clubId, value.external.source, value.external.sourceUrl, now()]);
    }
    await db.execute(`insert into player_external_ids(player_id,source,external_id,source_url,created_at,updated_at)
      values($1,$2,$3,$4,$5,$5) on conflict(source,external_id) do update set
      player_id=excluded.player_id,source_url=excluded.source_url,updated_at=excluded.updated_at`,
    [playerId, value.external.source, value.external.externalId, value.external.sourceUrl, now()]);
  }
  const changed = Boolean(linked) && (
    linked!.name !== value.fullName || linked!.display_name !== value.displayName || linked!.club_id !== clubId ||
    linked!.position !== value.position || String(linked!.date_of_birth ?? '') !== String(value.dateOfBirth ?? '') ||
    linked!.nationality !== value.nationality || Number(linked!.shirt_number ?? 0) !== Number(value.shirtNumber ?? 0) ||
    linked!.image_url !== value.imageUrl
  );
  if (changed) {
    if (previousClubId !== clubId) {
      await db.execute('update player_club_history set ended_at=$1 where player_id=$2 and source=$3 and ended_at is null',
        [now(), playerId, value.external.source]);
      await db.execute(`insert into player_club_history(id,player_id,from_club_id,to_club_id,source,source_url,detected_at)
        values($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), playerId, previousClubId, clubId, value.external.source, value.external.sourceUrl, now()]);
    }
    await db.execute(`update players set club_id=$1,name=$2,display_name=$3,normalized_name=$4,position=$5,
      date_of_birth=$6,nationality=$7,shirt_number=$8,image_url=$9,updated_at=$10 where id=$11`,
    [clubId, value.fullName, value.displayName, value.normalizedName, value.position, value.dateOfBirth,
      value.nationality, value.shirtNumber, value.imageUrl, now(), playerId]);
    result = 'updated';
  } else if (!linked) {
    await db.execute(`update players set image_url=coalesce($1,image_url),nationality=coalesce($2,nationality),
      shirt_number=coalesce($3,shirt_number),updated_at=$4 where id=$5`,
    [value.imageUrl, value.nationality, value.shirtNumber, now(), playerId]);
  }
  await db.execute('update player_external_ids set source_url=$1,updated_at=$2 where source=$3 and external_id=$4',
    [value.external.sourceUrl, now(), value.external.source, value.external.externalId]);
  return result;
}

async function upsertMatch(db: PostgresExecutor, value: NormalizedMatch): Promise<Result> {
  await db.execute(`insert into gameweeks(id,tournament_id,week_number,name,starts_at,deadline_at,ends_at,status)
    values($1,$2,$3,$4,$5,$6,null,$7) on conflict(id) do update set status=excluded.status`,
  [value.gameweekId, value.tournamentId, value.gameweekNumber, value.round ?? `Jornada ${value.gameweekNumber}`,
    value.startsAt, value.deadlineAt, value.gameweekStatus]);
  const linked = await db.maybeOne<Row>(`select m.* from match_external_ids x join matches m on m.id=x.match_id
    where x.source=$1 and x.external_id=$2`, [value.external.source, value.external.externalId]);
  const matchId = linked?.id ? String(linked.id) : randomUUID();
  let result: Result = 'unchanged';
  const homeId = await clubIdByName(db, normalizeIdentity(value.homeClub));
  const awayId = await clubIdByName(db, normalizeIdentity(value.awayClub));
  if (!linked) {
    await db.execute(`insert into matches(id,home_club_id,away_club_id,home_club_name,away_club_name,starts_at,
      home_score,away_score,round,created_at,updated_at,gameweek_id,score_status)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12)`,
    [matchId, homeId, awayId, value.homeClub, value.awayClub, value.startsAt, value.homeScore, value.awayScore,
      value.round, now(), value.gameweekId, value.scoreStatus]);
    await db.execute(`insert into match_external_ids(match_id,source,external_id,source_url,created_at,updated_at)
      values($1,$2,$3,$4,$5,$5)`, [matchId, value.external.source, value.external.externalId, value.external.sourceUrl, now()]);
    result = 'created';
  } else {
    const changed = linked.home_club_name !== value.homeClub || linked.away_club_name !== value.awayClub ||
      String(linked.starts_at ?? '') !== value.startsAt || Number(linked.home_score) !== Number(value.homeScore) ||
      Number(linked.away_score) !== Number(value.awayScore) || linked.round !== value.round ||
      linked.gameweek_id !== value.gameweekId || linked.score_status !== value.scoreStatus;
    if (changed) {
      await db.execute(`update matches set home_club_id=$1,away_club_id=$2,home_club_name=$3,away_club_name=$4,
        starts_at=$5,home_score=$6,away_score=$7,round=$8,updated_at=$9,gameweek_id=$10,score_status=$11 where id=$12`,
      [homeId, awayId, value.homeClub, value.awayClub, value.startsAt, value.homeScore, value.awayScore,
        value.round, now(), value.gameweekId, value.scoreStatus, matchId]);
      result = 'updated';
    }
  }
  await db.execute('update match_external_ids set source_url=$1,updated_at=$2 where source=$3 and external_id=$4',
    [value.external.sourceUrl, now(), value.external.source, value.external.externalId]);
  await db.execute(`update gameweeks set starts_at=(select min(starts_at) from matches where gameweek_id=$1),
    deadline_at=(select min(starts_at) from matches where gameweek_id=$1) where id=$1`, [value.gameweekId]);
  return result;
}

async function upsertPlayerStat(db: PostgresExecutor, value: NormalizedPlayerStat): Promise<Result> {
  const player = await db.maybeOne<{ id: string }>('select player_id as id from player_external_ids where source=$1 and external_id=$2',
    [value.external.source, value.playerExternalId]);
  const match = await db.maybeOne<{ id: string }>('select match_id as id from match_external_ids where source=$1 and external_id=$2',
    [value.external.source, value.matchExternalId]);
  if (!player || !match) return 'unchanged';
  const previous = await db.maybeOne<Row>('select * from player_match_stats where player_id=$1 and match_id=$2', [player.id, match.id]);
  const clubId = value.clubName ? await clubIdByName(db, normalizeIdentity(value.clubName)) : null;
  await db.execute(`insert into player_match_stats(player_id,match_id,source,starter,substitute_in,minutes,goals,assists,
    yellow_cards,red_cards,own_goals,saves,source_url,external_id,updated_at,club_id,assist_status)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    on conflict(player_id,match_id) do update set source=excluded.source,starter=excluded.starter,
    substitute_in=excluded.substitute_in,minutes=excluded.minutes,goals=excluded.goals,assists=excluded.assists,
    yellow_cards=excluded.yellow_cards,red_cards=excluded.red_cards,own_goals=excluded.own_goals,saves=excluded.saves,
    source_url=excluded.source_url,external_id=excluded.external_id,updated_at=excluded.updated_at,
    club_id=excluded.club_id,assist_status=excluded.assist_status`,
  [player.id, match.id, value.external.source, value.starter, value.substituteIn, value.minutes, value.goals,
    value.assists, value.yellowCards, value.redCards, value.ownGoals, value.saves, value.external.sourceUrl,
    value.external.externalId, now(), clubId, value.assistStatus ?? 'PENDING']);
  if (!previous) return 'created';
  const fields = ['minutes','goals','assists','yellow_cards','red_cards','own_goals','saves'] as const;
  const fresh = [value.minutes,value.goals,value.assists,value.yellowCards,value.redCards,value.ownGoals,value.saves];
  return fresh.some((entry, index) => Number(entry ?? 0) !== Number(previous[fields[index]] ?? 0)) ? 'updated' : 'unchanged';
}

async function upsertObservation(db: PostgresExecutor, value: SourceObservation): Promise<'created' | 'unchanged'> {
  const rows = await db.query<{ id: string }>(`insert into source_observations
    (id,source,entity_type,external_entity_id,source_url,parser_version,observed_at,content_hash,value_json)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) on conflict do nothing returning id`,
  [randomUUID(), value.source, value.entityType, value.externalEntityId, value.sourceUrl, value.parserVersion,
    value.observedAt, value.contentHash, JSON.stringify(value.value)]);
  return rows.length ? 'created' : 'unchanged';
}

function transactionWriters(db: PostgresExecutor): CanonicalDataTransaction {
  return {
    upsertClub: value => upsertClub(db, value),
    upsertPlayer: value => upsertPlayer(db, value),
    upsertMatch: value => upsertMatch(db, value),
    upsertPlayerStat: value => upsertPlayerStat(db, value),
    upsertObservation: value => upsertObservation(db, value),
  };
}

export function createPostgresCanonicalDataRepository(db: PostgresDatabase): CanonicalDataRepository {
  return {
    transaction: work => db.transaction(tx => work(transactionWriters(tx))),
    recordSyncRun: async (run: SyncRunRecord) => {
      await db.execute(`insert into sync_runs(run_id,source,job,started_at,finished_at,status,records_found,
        records_created,records_updated,conflicts,errors_json) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
        on conflict(run_id) do update set finished_at=excluded.finished_at,status=excluded.status,
        records_found=excluded.records_found,records_created=excluded.records_created,
        records_updated=excluded.records_updated,conflicts=excluded.conflicts,errors_json=excluded.errors_json`,
      [run.runId, run.source, run.job, run.startedAt, run.finishedAt, run.status, run.recordsFound,
        run.recordsCreated, run.recordsUpdated, run.conflicts, JSON.stringify(run.errors)]);
    },
  };
}
