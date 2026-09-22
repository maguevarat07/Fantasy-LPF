import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresDatabase, type PostgresDatabase } from '../postgres/client.js';
import { consumePipelineQueueMessage, type PipelineQueueMessage } from './queueWorker.js';
import { buildResult } from './adapter.js';
import { IngestionOrchestrator } from './orchestrator.js';
import type { SyncReport } from './types.js';

const testUrl = process.env.POSTGRES_TEST_URL;
const suffix = randomUUID().replaceAll('-', '').slice(0, 20);
const schema = `qa_queue_${suffix}`;
const queue = `fantasy_pipeline_qa_${suffix}`;
const job = `QA_fantasy_pipeline_${suffix}`;
const runId = `QA_${suffix}`;
let admin: Sql;
let db: PostgresDatabase;
let queueCreated = false;
let cronCreated = false;

function report(): Promise<SyncReport> {
  const now = new Date().toISOString();
  const clubs = ['QA Atlético', 'QA Deportivo'].map((name, index) => ({
    kind: 'club' as const, name, normalizedName: name.toLowerCase(),
    external: { source: 'TRANSFERMARKT' as const, externalId: `qa-club-${index}`,
      sourceUrl: 'https://qa.invalid/club' },
  }));
  const player = (source: 'LPF' | 'TRANSFERMARKT', clubName: string) => ({
    kind: 'player' as const, fullName: 'Jugador Ambiguo', displayName: 'Jugador Ambiguo',
    normalizedName: 'jugador ambiguo', clubName, normalizedClubName: clubName.toLowerCase(),
    position: 'MID' as const, dateOfBirth: null, nationality: null, shirtNumber: null, imageUrl: null,
    external: { source, externalId: `qa-ambiguous-${source}`, sourceUrl: 'https://qa.invalid/player' },
  });
  return new IngestionOrchestrator([
    { source: 'TRANSFERMARKT', parserVersion: 'qa', collect: async () => buildResult({
      source: 'TRANSFERMARKT', parserVersion: 'qa', startedAt: now, urls: [],
      entities: [...clubs, player('TRANSFERMARKT', 'QA Atlético')],
    }) },
    { source: 'LPF', parserVersion: 'qa', collect: async () => buildResult({
      source: 'LPF', parserVersion: 'qa', startedAt: now, urls: [],
      entities: [player('LPF', 'QA Deportivo')],
    }) },
    { source: 'SOCCERWAY', parserVersion: 'qa', collect: async () => {
      throw new Error('Fuente QA no disponible');
    } },
  ]).sync({ adapterTimeoutMs: 2_000 });
}

describe.skipIf(!testUrl)('Supabase Cron + Basic Queue QA aislados', () => {
  beforeAll(async () => {
    admin = postgres(testUrl!, { max: 1, prepare: false });
    await admin.unsafe(`create schema "${schema}"`);
    db = createPostgresDatabase({ url: testUrl!, maxConnections: 1 });
    await db.execute(`set search_path to "${schema}", public`);
    expect((await db.one<{ name: string }>('select current_schema() as name')).name).toBe(schema);
    for (const file of ['202609150001_initial_schema.sql', '202609160001_sync_leases.sql']) {
      await db.execute(await readFile(`supabase/migrations/${file}`, 'utf8'));
    }
    await db.execute('create table app_schema_migrations(version text primary key, checksum text not null, applied_at timestamptz not null default now())');
    for (const file of ['202609190001_rls_isolation.sql', '202609190002_durable_pipeline.sql',
      '202609190003_ingest_payload.sql', '202609210002_pricing_input_snapshot.sql',
      '202609210003_pipeline_score_cursor.sql']) {
      await db.execute((await readFile(`supabase/migrations/${file}`, 'utf8')).replaceAll('public.', `"${schema}".`));
    }
    await db.execute(`grant usage on schema "${schema}" to fantasy_lpf_app`);
    const extensions = await db.query<{ extname: string }>(
      "select extname from pg_extension where extname in ('pgmq','pg_cron')");
    expect(extensions.map(value => value.extname).sort()).toEqual(['pg_cron', 'pgmq']);
    const migration = (await readFile('supabase/migrations/202609200001_pipeline_queue.sql', 'utf8'))
      .replaceAll('fantasy_pipeline', queue)
      .replaceAll('public.', `"${schema}".`)
      .replace('revoke all on schema pgmq from anon, authenticated, fantasy_lpf_app;', '');
    await db.execute(migration);
    queueCreated = true;
    const now = new Date().toISOString();
    await db.execute("insert into tournaments(id,name,status,budget_cents,created_at) values('apertura-2026','QA','ACTIVE',10000000000,$1)", [now]);
    await db.execute("insert into gameweeks(id,tournament_id,week_number,name,deadline_at,status) values('gw-1','apertura-2026',1,'QA GW','2026-09-10T01:00:00Z','FINISHED')");
    await db.execute("insert into clubs(id,name,code,active,normalized_name) values('club-a','Plaza Amador','PLA',true,'plaza amador'),('club-b','Tauro FC','TAU',true,'tauro')");
    await db.execute(`insert into players(id,club_id,name,position,price_cents,status,active,updated_at,normalized_name)
      values('player-a','club-a','Jugador A','FWD',500000000,'ACTIVE',true,$1,'jugador a')`, [now]);
    await db.execute("insert into tournament_players(tournament_id,player_id,price_cents,active) values('apertura-2026','player-a',500000000,true)");
    await db.execute(`insert into matches(id,home_club_id,away_club_id,home_club_name,away_club_name,
      starts_at,home_score,away_score,round,created_at,updated_at,gameweek_id,score_status)
      values('match-a','club-a','club-b','Plaza Amador','Tauro FC','2026-09-10T01:00:00Z',2,1,'QA',$1,$1,'gw-1','CONFIRMED')`, [now]);
    await db.execute(`insert into player_match_stats(player_id,match_id,source,starter,substitute_in,goals,assists,
      yellow_cards,red_cards,own_goals,saves,source_url,external_id,updated_at,club_id,assist_status)
      values('player-a','match-a','TRANSFERMARKT',true,false,1,1,0,0,0,0,'https://qa.invalid/a','qa-a',$1,'club-a','CONFIRMED')`, [now]);
    await db.execute("insert into pipeline_runs(id,stage,started_at,updated_at) values($1,'CREATED',now(),now())", [runId]);
  }, 120_000);

  afterAll(async () => {
    if (cronCreated) await db?.query('select cron.unschedule($1)', [job]);
    if (queueCreated) await db?.query('select pgmq.drop_queue($1)', [queue]);
    await db?.close();
    if (admin) { await admin.unsafe(`drop schema if exists "${schema}" cascade`); await admin.end({ timeout: 5 }); }
  }, 30_000);

  it('Cron encola y el consumidor avanza hasta PRICED sin tocar public', async () => {
    const message: PipelineQueueMessage = { runId, tournamentId: 'apertura-2026', gameweekId: 'gw-1',
      stage: 'INGEST', cursor: { entity: 0, observation: 0 }, attempt: 0,
      createdAt: new Date().toISOString() };
    const command = `select "${schema}".dispatch_${queue}_message()`;
    await db.query('select cron.schedule($1,$2,$3)', [job, '* * * * *', command]);
    cronCreated = true;
    const deadline = Date.now() + 90_000;
    let pending = 0;
    while (Date.now() < deadline) {
      pending = (await db.one<{ n: number }>(`select count(*)::int as n from pgmq.q_${queue}`)).n;
      if (pending) break;
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    expect(pending).toBe(1);
    const cronRun = await db.maybeOne<{ status: string }>(`select d.status from cron.job_run_details d
      join cron.job j on j.jobid=d.jobid where j.jobname=$1 order by d.start_time desc limit 1`, [job]);
    expect(cronRun?.status).toBe('succeeded');
    await db.query('select cron.unschedule($1)', [job]);
    cronCreated = false;
    const stages: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const result = await consumePipelineQueueMessage(db, queue,
        { ingest: async () => report(), publishEntityBatchSize: 1 });
      expect(result.archived).toBe(true);
      stages.push(result.stage!);
      if (result.stage === 'PUBLISHING') {
        expect((await db.one<{ entity_cursor: number }>(
          'select entity_cursor from pipeline_ingest_payloads where run_id=$1', [runId])).entity_cursor).toBe(1);
      }
      if (result.stage === 'PRICED') break;
    }
    expect(stages).toEqual(['INGESTED', 'PUBLISHING', 'RECONCILED', 'SCORED', 'PRICED']);
    expect((await db.one<{ n: number }>("select count(*)::int as n from club_external_ids where external_id like 'qa-club-%'")).n).toBe(2);
    expect((await db.one<{ n: number }>("select count(*)::int as n from pipeline_conflicts where severity='BLOCKING'")).n).toBe(1);
    expect((await db.one<{ n: number }>("select count(*)::int as n from pipeline_conflicts where severity='NON_BLOCKING'")).n).toBe(1);
    expect((await db.one<{ n: number }>('select count(*)::int as n from player_fantasy_points')).n).toBe(1);
    expect((await db.one<{ n: number }>('select count(*)::int as n from pricing_runs')).n).toBe(1);
    expect((await db.one<{ n: number }>(`select count(*)::int as n from pgmq.a_${queue}`)).n).toBe(5);
    await db.query('select pgmq.send($1::text,$2::jsonb,0::integer)', [queue, JSON.stringify(message)]);
    const replay = await consumePipelineQueueMessage(db, queue, { ingest: async () => report() });
    expect(replay.stage).toBe('PRICED');
    expect((await db.one<{ n: number }>('select count(*)::int as n from pricing_runs')).n).toBe(1);
    await expect(db.transaction(async tx => {
      await tx.execute('set local role fantasy_lpf_app');
      await tx.query(`select * from "${schema}".pipeline_runs`);
    })).rejects.toThrow();
    await expect(db.transaction(async tx => {
      await tx.execute('set local role fantasy_lpf_app');
      await tx.query(`select * from pgmq.q_${queue}`);
    })).rejects.toThrow();
  }, 150_000);

  it('la visibilidad impide entrega concurrente y permite redelivery tras el timeout', async () => {
    const payload = { runId, tournamentId: 'apertura-2026', gameweekId: 'gw-1',
      stage: 'INGEST', cursor: { entity: 0, observation: 0 }, attempt: 0,
      createdAt: new Date().toISOString() };
    await db.query('select pgmq.send($1::text,$2::jsonb,0::integer)', [queue, JSON.stringify(payload)]);
    const first = await db.one<{ msg_id: string; read_ct: string }>('select * from pgmq.read($1,1,1)', [queue]);
    expect((await db.query('select * from pgmq.read($1,1,1)', [queue])).length).toBe(0);
    await new Promise(resolve => setTimeout(resolve, 1_300));
    const second = await db.one<{ msg_id: string; read_ct: string }>('select * from pgmq.read($1,1,1)', [queue]);
    expect(second.msg_id).toBe(first.msg_id);
    expect(Number(second.read_ct)).toBe(2);
    await db.query('select pgmq.archive($1,$2::bigint)', [queue, first.msg_id]);
  }, 30_000);

  it('fallo conserva mensaje, respeta backoff y reanuda el mismo run', async () => {
    const retryId = `QA_retry_${suffix}`;
    await db.execute("insert into pipeline_runs(id,stage,started_at,updated_at) values($1,'CREATED',now(),now())", [retryId]);
    const message: PipelineQueueMessage = { runId: retryId, tournamentId: 'apertura-2026',
      gameweekId: 'gw-1', stage: 'INGEST', cursor: { entity: 0, observation: 0 },
      attempt: 0, createdAt: new Date().toISOString() };
    const sent = await db.one<{ msg_id: string }>(
      'select pgmq.send($1::text,$2::jsonb,0::integer) as msg_id', [queue, JSON.stringify(message)]);
    await expect(consumePipelineQueueMessage(db, queue,
      { ingest: async () => { throw new Error('fuente QA caída'); } })).rejects.toThrow('fuente QA caída');
    const failed = await db.one<{ stage: string; attempts: number; next_retry_at: string }>(
      'select stage,attempts,next_retry_at from pipeline_runs where id=$1', [retryId]);
    expect(failed.stage).toBe('INGESTING');
    expect(failed.attempts).toBe(1);
    expect(Date.parse(failed.next_retry_at)).toBeGreaterThan(Date.now());
    expect((await db.one<{ n: number }>(`select count(*)::int as n from pgmq.q_${queue}`)).n).toBe(1);
    await db.query('select pgmq.set_vt($1,$2::bigint,0::integer)', [queue, sent.msg_id]);
    const deferred = await consumePipelineQueueMessage(db, queue, { ingest: async () => report() });
    expect(deferred.stage).toBe('INGESTING');
    expect(deferred.nextStage).toBe('INGEST');
    await db.execute("update pipeline_runs set next_retry_at=now()-interval '1 second' where id=$1", [retryId]);
    const delayed = await db.one<{ msg_id: string }>(`select msg_id from pgmq.q_${queue}`);
    await db.query('select pgmq.set_vt($1,$2::bigint,0::integer)', [queue, delayed.msg_id]);
    const recovered = await consumePipelineQueueMessage(db, queue, { ingest: async () => report() });
    expect(recovered.runId).toBe(retryId);
    expect(recovered.stage).toBe('INGESTED');
  }, 45_000);

  it('cinco entregas interrumpidas agotan el mensaje y persisten FAILED', async () => {
    const current = await db.one<{ msg_id: string }>(`select msg_id from pgmq.q_${queue}`);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const read = await db.one<{ msg_id: string }>('select * from pgmq.read($1,540,1)', [queue]);
      expect(read.msg_id).toBe(current.msg_id);
      await db.query('select pgmq.set_vt($1,$2::bigint,0::integer)', [queue, current.msg_id]);
    }
    const exhausted = await consumePipelineQueueMessage(db, queue, { ingest: async () => report() });
    expect(exhausted.stage).toBe('FAILED');
    const run = await db.one<{ stage: string; last_error: string }>(
      "select stage,last_error from pipeline_runs where id=$1", [`QA_retry_${suffix}`]);
    expect(run.stage).toBe('FAILED');
    expect(run.last_error).toContain('cinco entregas');
    expect((await db.one<{ n: number }>(`select count(*)::int as n from pgmq.q_${queue}`)).n).toBe(0);
  }, 30_000);
});
