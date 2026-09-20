import { randomUUID } from 'node:crypto';
import { createDefaultIngestionOrchestrator } from './index.js';
import type { SyncReport } from './types.js';
import { classifyAndFilter } from './conflicts.js';
import { persistEntities } from './repository.js';
import { getPostgresDatabase } from '../postgres/client.js';
import type { PostgresDatabase } from '../postgres/client.js';
import { createPostgresCanonicalDataRepository } from '../postgres/canonicalRepository.js';
import { recalculateGameweekPostgres, recalculateLatestPricesPostgres } from '../postgres/economy.js';
import { matchVerificationKey } from './verification.js';

type PipelineStage = 'CREATED' | 'INGESTING' | 'INGESTED' | 'NORMALIZED' | 'RECONCILED'
  | 'PUBLISHING' | 'SCORING' | 'SCORED' | 'PRICING' | 'PRICED' | 'PARTIAL' | 'FAILED';
type NextStage = 'INGEST' | 'PUBLISH' | 'SCORE' | 'PRICE' | null;
interface PipelineRun extends Record<string, unknown> {
  id: string;
  stage: PipelineStage;
  started_at: string;
  attempts: number;
  next_retry_at: string | null;
  conflicts_blocking: number;
  conflicts_non_blocking: number;
  quality_status: string;
}

export function nextPipelineStage(stage: PipelineStage): NextStage {
  if (['CREATED','INGESTING'].includes(stage)) return 'INGEST';
  if (['INGESTED','NORMALIZED','PUBLISHING'].includes(stage)) return 'PUBLISH';
  if (stage === 'RECONCILED' || stage === 'SCORING') return 'SCORE';
  if (stage === 'SCORED' || stage === 'PRICING') return 'PRICE';
  return null;
}

export function pipelineRetryDelayMs(attempts: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

export interface ScheduledDataSyncResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  status: 'WORKING' | 'PARTIAL';
  stage: PipelineStage;
  nextStage: NextStage;
}

export class ScheduledSyncUnavailableError extends Error {
  constructor() {
    super('La sincronización de producción espera la conexión PostgreSQL/Supabase.');
    this.name = 'ScheduledSyncUnavailableError';
  }
}

export interface ScheduledSyncDependencies {
  db?: PostgresDatabase;
  ingest?: () => Promise<SyncReport>;
  publishEntityBatchSize?: number;
  publishObservationBatchSize?: number;
  scoreGameweek?: typeof recalculateGameweekPostgres;
  price?: typeof recalculateLatestPricesPostgres;
}

export async function runScheduledDataSync(dependencies: ScheduledSyncDependencies = {}): Promise<ScheduledDataSyncResult> {
  if (!dependencies.db && !process.env.DATABASE_URL && !process.env.POSTGRES_URL) throw new ScheduledSyncUnavailableError();
  // This is intentionally the internal postgres connection. User-facing API
  // queries use SET LOCAL ROLE fantasy_lpf_app and never call this worker.
  const db = dependencies.db ?? getPostgresDatabase();
  const owner = randomUUID();
  const startedAt = new Date().toISOString();
  const lease = await db.query<{ owner: string }>(`insert into sync_leases(name,owner,acquired_at,expires_at)
    values('canonical-pipeline',$1,now(),now()+interval '8 minutes')
    on conflict(name) do update set owner=excluded.owner,acquired_at=excluded.acquired_at,
      expires_at=excluded.expires_at where sync_leases.expires_at < now() returning owner`, [owner]);
  if (!lease.length) {
    return { runId: 'already-running', startedAt, finishedAt: new Date().toISOString(),
      status: 'PARTIAL', stage: 'INGESTING', nextStage: null };
  }
  try {
    let run = await db.maybeOne<PipelineRun>(`select * from pipeline_runs
      where stage not in ('PRICED','PARTIAL','FAILED') order by started_at limit 1`);
    if (!run) {
      const recent = await db.maybeOne<PipelineRun>(`select * from pipeline_runs
        where stage in ('PRICED','PARTIAL') and finished_at > now()-interval '20 hours'
        order by finished_at desc limit 1`);
      if (recent) return { runId: recent.id, startedAt, finishedAt: new Date().toISOString(),
        status: recent.quality_status === 'WORKING' ? 'WORKING' : 'PARTIAL',
        stage: recent.stage, nextStage: null };
      const id = randomUUID();
      run = await db.one<PipelineRun>(`insert into pipeline_runs(id,stage,started_at,updated_at)
        values($1,'CREATED',now(),now()) returning *`, [id]);
    }
    const pending = nextPipelineStage(run.stage);
    if (!pending || (run.next_retry_at && Date.parse(run.next_retry_at) > Date.now())) {
      return { runId: run.id, startedAt, finishedAt: new Date().toISOString(), status: 'PARTIAL',
        stage: run.stage, nextStage: pending };
    }
    const stageStartedAt = Date.now();
    const activeStage = pending === 'INGEST' ? 'INGESTING' : pending === 'PUBLISH' ? 'PUBLISHING'
      : pending === 'SCORE' ? 'SCORING' : 'PRICING';
    await db.execute(`update pipeline_runs set stage=$1,attempts=attempts+1,next_retry_at=null,
      updated_at=now(),last_error=null where id=$2`, [activeStage, run.id]);
    try {
      if (pending === 'INGEST') {
        const report = await (dependencies.ingest ?? (() => createDefaultIngestionOrchestrator().sync()))();
        await db.transaction(async tx => {
          await tx.execute(`insert into pipeline_ingest_payloads(run_id,report_json)
            values($1,$2::jsonb) on conflict(run_id) do update set report_json=excluded.report_json,
            entity_cursor=0,observation_cursor=0,records_created=0,records_updated=0,updated_at=now()`,
          [run.id, JSON.stringify(report)]);
          await tx.execute(`update pipeline_runs set stage='INGESTED',ingestion_run_id=$1,
            records_fetched=$2,updated_at=now(),attempts=0,
            stage_durations_json=jsonb_set(stage_durations_json,'{ingest}',to_jsonb($3::bigint),true)
            where id=$4`, [report.runId, report.adapters.reduce((sum, adapter) =>
            sum + adapter.entities.length + adapter.observations.length, 0), Date.now() - stageStartedAt, run.id]);
        });
        return { runId: run.id, startedAt, finishedAt: new Date().toISOString(),
          status: 'PARTIAL', stage: 'INGESTED', nextStage: 'PUBLISH' };
      }
      if (pending === 'PUBLISH') {
        const payload = await db.one<{ report_json: SyncReport | string; entity_cursor: number;
          observation_cursor: number }>('select * from pipeline_ingest_payloads where run_id=$1', [run.id]);
        const report: SyncReport = typeof payload.report_json === 'string'
          ? JSON.parse(payload.report_json) as SyncReport : payload.report_json;
        const publication = classifyAndFilter(report.adapters, report.reconciliation, report.verification);
        const entities = publication.accepted.filter(entity => entity.kind !== 'player'
          || (entity.normalizedClubName && entity.position));
        const observations = report.adapters.flatMap(adapter => adapter.observations);
        const nextEntityCursor = Math.min(entities.length, payload.entity_cursor
          + Math.max(1, dependencies.publishEntityBatchSize ?? 250));
        const nextObservationCursor = payload.entity_cursor < entities.length ? payload.observation_cursor
          : Math.min(observations.length, payload.observation_cursor
          + Math.max(1, dependencies.publishObservationBatchSize ?? 1000));
        const persisted = await persistEntities(createPostgresCanonicalDataRepository(db),
          entities.slice(payload.entity_cursor, nextEntityCursor),
          observations.slice(payload.observation_cursor, nextObservationCursor));
        await db.execute(`update pipeline_ingest_payloads set entity_cursor=$1,observation_cursor=$2,
          records_created=records_created+$3,records_updated=records_updated+$4,updated_at=now()
          where run_id=$5`, [nextEntityCursor, nextObservationCursor,
          persisted.created, persisted.updated, run.id]);
        if (nextEntityCursor < entities.length || nextObservationCursor < observations.length) {
          await db.execute(`update pipeline_runs set stage='PUBLISHING',attempts=0,updated_at=now(),
            stage_durations_json=jsonb_set(stage_durations_json,'{publish}',
              to_jsonb(coalesce((stage_durations_json->>'publish')::bigint,0)+$1::bigint),true)
            where id=$2`, [Date.now() - stageStartedAt, run.id]);
          return { runId: run.id, startedAt, finishedAt: new Date().toISOString(),
            status: 'PARTIAL', stage: 'PUBLISHING', nextStage: 'PUBLISH' };
        }
        await finalizePublication(db, run.id, report, publication.accepted.length, stageStartedAt);
        return { runId: run.id, startedAt, finishedAt: new Date().toISOString(),
          status: report.publication.conflicts.length || report.adapters.some(adapter => adapter.status !== 'WORKING')
            ? 'PARTIAL' : 'WORKING', stage: 'RECONCILED', nextStage: 'SCORE' };
      }
      if (pending === 'SCORE') {
        const finished = await db.query<{ id: string }>("select id from gameweeks where status='FINISHED' order by week_number");
        let incomplete = 0;
        for (const gameweek of finished) {
          const matches = await db.one<{ total: number; confirmed: number }>(`select count(*)::int as total,
            count(*) filter(where score_status in ('CONFIRMED','CORRECTED'))::int as confirmed
            from matches where gameweek_id=$1`, [gameweek.id]);
          await (dependencies.scoreGameweek ?? recalculateGameweekPostgres)(db, gameweek.id);
          const gameweekStatus = matches.total > 0 && matches.total === matches.confirmed ? 'SCORED' : 'PARTIAL';
          if (gameweekStatus !== 'SCORED') incomplete += 1;
          await db.execute(`insert into pipeline_gameweek_status(gameweek_id,scoring_status,scored_at,
            last_run_id,updated_at) values($1,$2,now(),$3,now()) on conflict(gameweek_id) do update
            set scoring_status=excluded.scoring_status,scored_at=excluded.scored_at,
              last_run_id=excluded.last_run_id,updated_at=excluded.updated_at`, [gameweek.id, gameweekStatus, run.id]);
        }
        await db.execute(`update pipeline_gameweek_status pgs set pricing_status='PRICED',
          priced_at=historic.completed_at,updated_at=now() from
          (select as_of_gameweek_id,max(completed_at) as completed_at from pricing_runs
            where status='COMPLETED' group by as_of_gameweek_id) historic
          where historic.as_of_gameweek_id=pgs.gameweek_id
            and pgs.pricing_status <> 'PRICED'`);
        await db.execute(`update pipeline_runs set stage='SCORED',scoring_status=$1,
          updated_at=now(),attempts=0,stage_durations_json=jsonb_set(stage_durations_json,
          '{score}',to_jsonb($2::bigint),true) where id=$3`,
        [incomplete ? 'PARTIAL' : 'SCORED', Date.now() - stageStartedAt, run.id]);
        return { runId: run.id, startedAt, finishedAt: new Date().toISOString(),
          status: incomplete ? 'PARTIAL' : run.quality_status === 'WORKING' ? 'WORKING' : 'PARTIAL',
          stage: 'SCORED', nextStage: 'PRICE' };
      }
      const latest = await db.maybeOne<{ id: string; scoring_status: string }>(`select gw.id,
        coalesce(pgs.scoring_status,'PENDING') as scoring_status from gameweeks gw
        left join pipeline_gameweek_status pgs on pgs.gameweek_id=gw.id
        where gw.tournament_id='apertura-2026' and gw.status='FINISHED'
        order by gw.week_number desc limit 1`);
      // Identity conflicts quarantine only their own entities. Pricing is held
      // when a finished gameweek has unverified match data, not for an
      // unrelated roster discrepancy.
      if (latest && latest.scoring_status !== 'SCORED') {
        await db.execute(`update pipeline_runs set stage='PARTIAL',quality_status='PARTIAL',
          pricing_status='PENDING_CONFLICT',finished_at=now(),updated_at=now(),
          duration_ms=(extract(epoch from(now()-started_at))*1000)::bigint where id=$1`, [run.id]);
        if (latest) await db.execute(`insert into pipeline_gameweek_status(gameweek_id,pricing_status,
          last_run_id,updated_at) values($1,'PENDING_CONFLICT',$2,now()) on conflict(gameweek_id) do update
          set pricing_status='PENDING_CONFLICT',last_run_id=excluded.last_run_id,updated_at=excluded.updated_at`,
        [latest.id, run.id]);
        return { runId: run.id, startedAt, finishedAt: new Date().toISOString(),
          status: 'PARTIAL', stage: 'PARTIAL', nextStage: null };
      }
      const result = await (dependencies.price ?? recalculateLatestPricesPostgres)(db);
      if (latest && !('skipped' in result)) await db.execute(`insert into pipeline_gameweek_status
        (gameweek_id,pricing_status,priced_at,last_run_id,updated_at) values($1,'PRICED',now(),$2,now())
        on conflict(gameweek_id) do update set pricing_status='PRICED',priced_at=excluded.priced_at,
          last_run_id=excluded.last_run_id,updated_at=excluded.updated_at`, [latest.id, run.id]);
      await db.execute(`update pipeline_runs set stage='PRICED',pricing_status=$1,finished_at=now(),
        updated_at=now(),attempts=0,duration_ms=(extract(epoch from(now()-started_at))*1000)::bigint,
        stage_durations_json=jsonb_set(stage_durations_json,'{price}',to_jsonb($2::bigint),true)
        where id=$3`, ['skipped' in result ? 'SKIPPED' : 'PRICED', Date.now() - stageStartedAt, run.id]);
      return { runId: run.id, startedAt, finishedAt: new Date().toISOString(),
        status: run.quality_status === 'WORKING' ? 'WORKING' : 'PARTIAL', stage: 'PRICED', nextStage: null };
    } catch (error) {
      const attempts = run.attempts + 1;
      const failed = attempts >= 5;
      await db.execute(`update pipeline_runs set stage=$1,quality_status='PARTIAL',
        last_error=$2,next_retry_at=case when $3::boolean then null else now()+($4::bigint * interval '1 millisecond') end,
        finished_at=case when $3::boolean then now() else null end,updated_at=now()
        where id=$5`, [failed ? 'FAILED' : activeStage,
        error instanceof Error ? error.message : String(error), failed, pipelineRetryDelayMs(attempts), run.id]);
      throw error;
    }
  } finally {
    await db.execute('delete from sync_leases where name=$1 and owner=$2', ['canonical-pipeline', owner]);
  }
}

async function finalizePublication(db: PostgresDatabase, runId: string, report: SyncReport,
  accepted: number, stageStartedAt: number): Promise<void> {
  await updateTournamentRoster(db, report);
  await quarantineConflictedMatches(db, report.publication.blockingMatchKeys);
  await linkVerifiedMatchIds(db, report);
  const repository = createPostgresCanonicalDataRepository(db);
  for (const adapter of report.adapters) await repository.recordSyncRun({
    runId: `${report.runId}:${adapter.source}`, source: adapter.source, job: 'canonical-sync',
    startedAt: adapter.startedAt, finishedAt: adapter.finishedAt, status: adapter.status,
    recordsFound: adapter.entities.length + adapter.observations.length,
    recordsCreated: 0, recordsUpdated: 0,
    conflicts: report.publication.conflicts.filter(conflict => conflict.sources.includes(adapter.source)).length,
    errors: adapter.errors,
  });
  const totals = await db.one<{ records_created: number; records_updated: number }>(
    'select records_created,records_updated from pipeline_ingest_payloads where run_id=$1', [runId]);
  const status = report.publication.conflicts.length || report.adapters.some(adapter => adapter.status !== 'WORKING')
    ? 'PARTIAL' : 'WORKING';
  await repository.recordSyncRun({ runId: report.runId, source: 'ALL', job: 'canonical-sync',
    startedAt: report.adapters.map(adapter => adapter.startedAt).sort()[0] ?? new Date().toISOString(),
    finishedAt: new Date().toISOString(), status,
    recordsFound: report.adapters.reduce((sum, adapter) => sum + adapter.entities.length + adapter.observations.length, 0),
    recordsCreated: totals.records_created, recordsUpdated: totals.records_updated,
    conflicts: report.publication.conflicts.length, errors: report.adapters.flatMap(adapter => adapter.errors) });
  await db.transaction(async tx => {
    await tx.execute(`update pipeline_runs set stage='RECONCILED',quality_status=$1,
      records_accepted=$2,conflicts_blocking=$3,conflicts_non_blocking=$4,
      source_summary_json=$5::jsonb,updated_at=now(),attempts=0,
      stage_durations_json=jsonb_set(stage_durations_json,'{publish}',
        to_jsonb(coalesce((stage_durations_json->>'publish')::bigint,0)+$6::bigint),true)
      where id=$7`, [status, accepted, report.publication.blocking, report.publication.nonBlocking,
      JSON.stringify(report.adapters.map(adapter => ({ source: adapter.source, status: adapter.status,
        fetched: adapter.entities.length + adapter.observations.length,
        accepted: report.publication.acceptedBySource[adapter.source] ?? 0,
        conflictsBlocking: report.publication.conflicts.filter(conflict => conflict.severity === 'BLOCKING'
          && conflict.sources.includes(adapter.source)).length,
        conflictsNonBlocking: report.publication.conflicts.filter(conflict => conflict.severity === 'NON_BLOCKING'
          && conflict.sources.includes(adapter.source)).length,
        errors: adapter.errors.length, startedAt: adapter.startedAt, finishedAt: adapter.finishedAt }))),
      Date.now() - stageStartedAt, runId]);
    for (const conflict of report.publication.conflicts) await tx.execute(`insert into pipeline_conflicts
      (run_id,severity,kind,conflict_key,reason,sources_json,created_at)
      values($1,$2,$3,$4,$5,$6::jsonb,now()) on conflict(run_id,kind,conflict_key) do update
      set severity=excluded.severity,reason=excluded.reason,sources_json=excluded.sources_json`,
    [runId, conflict.severity, conflict.kind, conflict.key, conflict.reason, JSON.stringify(conflict.sources)]);
  });
}

async function quarantineConflictedMatches(db: PostgresDatabase, keys: string[]): Promise<void> {
  if (!keys.length) return;
  const matches = await db.query<{ id: string; home_club_name: string; away_club_name: string; starts_at: string }>(
    `select id,home_club_name,away_club_name,starts_at from matches where score_status in ('CONFIRMED','CORRECTED')`);
  for (const match of matches) {
    const key = matchVerificationKey({ homeClub: match.home_club_name, awayClub: match.away_club_name,
      startsAt: match.starts_at });
    if (keys.includes(key)) await db.execute("update matches set score_status='PENDING',updated_at=now() where id=$1", [match.id]);
  }
}

async function linkVerifiedMatchIds(db: PostgresDatabase, report: SyncReport): Promise<void> {
  const matches = await db.query<{ id: string; home_club_name: string; away_club_name: string;
    starts_at: string; home_score: number | null; away_score: number | null }>(
    `select id,home_club_name,away_club_name,starts_at,home_score,away_score from matches`);
  for (const group of report.verification.groups.filter(value => value.verdict === 'AGREEMENT')) {
    const matching = matches.filter(match => matchVerificationKey({ homeClub: match.home_club_name,
      awayClub: match.away_club_name, startsAt: match.starts_at }) === group.key
      && group.claims.every(claim => claim.homeScore === match.home_score && claim.awayScore === match.away_score));
    if (matching.length !== 1) continue;
    for (const claim of group.claims) await db.execute(`insert into match_external_ids
      (match_id,source,external_id,source_url,created_at,updated_at)
      values($1,$2,$3,$4,now(),now()) on conflict(source,external_id) do update
      set source_url=excluded.source_url,updated_at=excluded.updated_at
      where match_external_ids.match_id=excluded.match_id`,
    [matching[0].id, claim.source, claim.externalId, claim.sourceUrl]);
  }
}

async function updateTournamentRoster(db: ReturnType<typeof getPostgresDatabase>, report: SyncReport): Promise<void> {
  await db.execute(`insert into tournament_players(tournament_id,player_id,price_cents,active)
    select 'apertura-2026',id,case position when 'GK' then 400000000 when 'DEF' then 400000000
      when 'MID' then 450000000 when 'FWD' then 500000000 end,active
    from players where club_id is not null and position in ('GK','DEF','MID','FWD')
    on conflict(tournament_id,player_id) do nothing`);
  const transfermarkt = report.adapters.find(adapter => adapter.source === 'TRANSFERMARKT');
  const blocked = new Set(report.publication.blockedPlayerExternalKeys);
  const blockedTransfermarkt = [...blocked].some(key => key.startsWith('TRANSFERMARKT|'));
  const registered = transfermarkt?.entities.filter(entity => entity.kind === 'player'
    && !blocked.has(`${entity.external.source}|${entity.external.externalId}`)) ?? [];
  const clubs = new Set(registered.flatMap(player => player.kind === 'player' && player.normalizedClubName ? [player.normalizedClubName] : []));
  if (transfermarkt?.status !== 'WORKING' || clubs.size !== 12 || registered.length < 180) return;
  await db.transaction(async tx => {
    for (const player of registered) {
      if (player.kind !== 'player') continue;
      const canonical = await tx.maybeOne<{ player_id: string; club_id: string }>(`select p.id as player_id,p.club_id
        from player_external_ids x join players p on p.id=x.player_id
        where x.source='TRANSFERMARKT' and x.external_id=$1`, [player.external.externalId]);
      if (!canonical) continue;
      await tx.execute(`insert into tournament_roster_registrations
        (tournament_id,player_id,source,club_id,first_seen_at,last_seen_at,ended_at,active)
        values('apertura-2026',$1,'TRANSFERMARKT',$2,$3,$3,null,true)
        on conflict(tournament_id,player_id,source) do update set club_id=excluded.club_id,
          last_seen_at=excluded.last_seen_at,ended_at=null,active=true`,
      [canonical.player_id, canonical.club_id, transfermarkt.finishedAt]);
    }
    // An ambiguous identity must not make an otherwise registered player look
    // departed. Full-snapshot deactivation is safe only with no roster blockers.
    if (!blockedTransfermarkt) {
      await tx.execute(`update tournament_roster_registrations set active=false,ended_at=$1
        where tournament_id='apertura-2026' and source='TRANSFERMARKT' and active=true and last_seen_at<>$1`,
      [transfermarkt.finishedAt]);
      await tx.execute(`update tournament_players set active=exists(select 1 from tournament_roster_registrations r
        where r.tournament_id='apertura-2026' and r.source='TRANSFERMARKT' and r.active=true
          and r.player_id=tournament_players.player_id) where tournament_id='apertura-2026'`);
    }
  });
}
