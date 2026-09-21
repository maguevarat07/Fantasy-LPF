import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPostgresDatabase, type PostgresDatabase } from '../postgres/client.js';
import { createPostgresCanonicalDataRepository } from '../postgres/canonicalRepository.js';
import { persistEntities } from './repository.js';
import { runScheduledDataSync } from './scheduledSync.js';
import { matchVerificationKey } from './verification.js';
import type { SyncReport } from './types.js';

const testUrl = process.env.POSTGRES_TEST_URL;
const schema = `qa_pipeline_${randomUUID().replaceAll('-', '')}`;
let admin: Sql;
let db: PostgresDatabase;
const matchAt = '2026-09-10T01:00:00.000Z';

function report(blockingMatchKeys: string[] = [], nonBlocking = 0): SyncReport {
  return {
    runId: randomUUID(), adapters: [{ source: 'TRANSFERMARKT', status: nonBlocking ? 'PARTIAL' : 'WORKING',
      parserVersion: 'qa', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      sourceUrls: [], entities: [], observations: [], warnings: nonBlocking ? ['metadata'] : [], errors: [], httpStatuses: [] }],
    reconciliation: { accepted: [], conflicts: [], potentialDuplicates: [] },
    persistence: { created: 0, updated: 0 },
    completeness: { generatedAt: new Date().toISOString(), clubsDetected: 0, playersDetected: 0,
      activePlayersByClub: {}, playersWithoutPosition: 0, playersWithoutClub: 0, potentialDuplicates: 0,
      playersOnlyInOneSource: 0, identityConflicts: 0, unresolvedPlayers: 0, demoPlayersDetected: null,
      sourceStatus: { LPF: 'NOT_VERIFIED', TRANSFERMARKT: 'WORKING', SOCCERWAY: 'NOT_VERIFIED',
        '365SCORES': 'NOT_VERIFIED', FOTMOB: 'NOT_VERIFIED' }, warnings: [] },
    verification: { generatedAt: new Date().toISOString(), matchClaimsBySource: {}, agreements: 0,
      conflicts: blockingMatchKeys.length, singleSource: 0, groups: [], playerTotalClaimsBySource: {},
      playerTotalsCompared: 0, playerFieldAgreements: 0, playerFieldDifferences: 0 },
    publication: { accepted: 0, quarantined: blockingMatchKeys.length,
      blocking: blockingMatchKeys.length, nonBlocking,
      conflicts: [
        ...blockingMatchKeys.map(key => ({ severity: 'BLOCKING' as const, kind: 'MATCH_RESULT' as const,
          key, reason: 'qa', sources: ['TRANSFERMARKT' as const, 'FOTMOB' as const] })),
        ...(nonBlocking ? [{ severity: 'NON_BLOCKING' as const, kind: 'OPTIONAL_METADATA' as const,
          key: 'optional', reason: 'qa', sources: ['LPF' as const] }] : []),
      ], blockingMatchKeys, blockedPlayerExternalKeys: [], acceptedBySource: {} },
  };
}

async function seed() {
  const now = new Date().toISOString();
  await db.execute("insert into tournaments(id,name,status,budget_cents,created_at) values('apertura-2026','QA','ACTIVE',10000000000,$1)", [now]);
  await db.execute("insert into gameweeks(id,tournament_id,week_number,name,deadline_at,status) values('gw-1','apertura-2026',1,'QA GW',$1,'FINISHED')", [matchAt]);
  await db.execute("insert into clubs(id,name,code,active,normalized_name) values('club-a','Plaza Amador','PLA',true,'plaza amador'),('club-b','Tauro FC','TAU',true,'tauro')");
  await db.execute(`insert into players(id,club_id,name,position,price_cents,status,active,updated_at,normalized_name)
    values('player-a','club-a','Jugador A','FWD',500000000,'ACTIVE',true,$1,'jugador a'),
      ('player-b','club-b','Jugador B','FWD',500000000,'ACTIVE',true,$1,'jugador b')`, [now]);
  await db.execute(`insert into tournament_players(tournament_id,player_id,price_cents,active)
    values('apertura-2026','player-a',500000000,true),('apertura-2026','player-b',500000000,true)`);
  await db.execute(`insert into matches(id,home_club_id,away_club_id,home_club_name,away_club_name,
    starts_at,home_score,away_score,round,created_at,updated_at,gameweek_id,score_status)
    values('match-a','club-a','club-b','Plaza Amador','Tauro FC',$1,2,1,'QA',$2,$2,'gw-1','CONFIRMED'),
      ('match-b','club-b','club-a','Tauro FC','Plaza Amador','2026-09-11T01:00:00Z',1,0,'QA',$2,$2,'gw-1','CONFIRMED')`,
  [matchAt, now]);
  await db.execute(`insert into player_match_stats(player_id,match_id,source,starter,substitute_in,goals,assists,
    yellow_cards,red_cards,own_goals,saves,source_url,external_id,updated_at,club_id,assist_status)
    values('player-a','match-a','TRANSFERMARKT',true,false,1,1,0,0,0,0,'https://qa.invalid/a','a',$1,'club-a','CONFIRMED'),
      ('player-a','match-b','TRANSFERMARKT',true,false,0,0,0,0,0,0,'https://qa.invalid/b','b',$1,'club-a','CONFIRMED')`, [now]);
  await db.execute(`insert into users(id,email,username,password_hash,created_at,updated_at)
    values('qa-user','qa@example.invalid','qauser','qa-only',$1,$1)`, [now]);
  await db.execute(`insert into fantasy_teams(id,user_id,tournament_id,name,formation,bank_cents,created_at,updated_at)
    values('qa-team','qa-user','apertura-2026','QA Team','4-3-3',9000000000,$1,$1)`, [now]);
  await db.execute(`insert into lineups(fantasy_team_id,gameweek_id,formation,captain_player_id,vice_captain_player_id,submitted_at)
    values('qa-team','gw-1','4-3-3','player-a','player-b',$1)`, [now]);
  await db.execute(`insert into lineup_players(fantasy_team_id,gameweek_id,player_id,role,slot)
    values('qa-team','gw-1','player-a','STARTER',0)`, []);
}

describe.skipIf(!testUrl)('pipeline durable con PostgreSQL real y RLS activo', () => {
  beforeAll(async () => {
    admin = postgres(testUrl!, { max: 1, prepare: false });
    await admin.unsafe(`create schema "${schema}"`);
    db = createPostgresDatabase({ url: testUrl!, maxConnections: 1 });
    await db.execute(`set search_path to "${schema}", public`);
    expect((await db.one<{ name: string }>('select current_schema() as name')).name).toBe(schema);
    for (const file of ['202609150001_initial_schema.sql','202609160001_sync_leases.sql']) {
      await db.execute(await readFile(`supabase/migrations/${file}`, 'utf8'));
    }
    await db.execute('create table app_schema_migrations(version text primary key, checksum text not null, applied_at timestamptz not null default now())');
    for (const file of ['202609190001_rls_isolation.sql','202609190002_durable_pipeline.sql',
      '202609190003_ingest_payload.sql','202609200002_player_identity_integrity.sql',
      '202609210001_identity_conflict_resolution.sql', '202609210002_pricing_input_snapshot.sql']) {
      await db.execute((await readFile(`supabase/migrations/${file}`, 'utf8')).replaceAll('public.', `"${schema}".`));
    }
    await db.execute(`grant usage on schema "${schema}" to fantasy_lpf_app`);
  }, 180_000);

  beforeEach(async () => {
    expect((await db.one<{ name: string }>('select current_schema() as name')).name).toBe(schema);
    await db.execute('truncate table pipeline_runs,sync_leases,users,tournaments,clubs cascade');
    await seed();
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    if (admin) { await admin.unsafe(`drop schema if exists "${schema}" cascade`); await admin.end({ timeout: 5 }); }
  }, 30_000);

  it('avanza INGEST → SCORE → PRICE con datos reales, y deja precio idempotente', async () => {
    const durations: number[] = [];
    const deps = { db, ingest: async () => report() };
    for (const stage of ['INGESTED','RECONCILED','SCORED','PRICED']) {
      const start = Date.now();
      const result = await runScheduledDataSync(deps);
      durations.push(Date.now() - start);
      expect(result.stage).toBe(stage);
    }
    expect(durations.every(duration => duration < 300_000)).toBe(true);
    expect((await db.one<{ count: number }>('select count(*)::int as count from player_fantasy_points')).count).toBe(2);
    expect((await db.one<{ total_points: number }>('select total_points from team_gameweek_scores')).total_points).toBeGreaterThan(0);
    expect((await db.one<{ count: number }>('select count(*)::int as count from pricing_runs where status=\'COMPLETED\'')).count).toBe(1);
    const run = await db.one<{ input_hash: string; input_snapshot_json: string }>(
      "select input_hash,input_snapshot_json from pricing_runs where status='COMPLETED'");
    const { replayPricingInputSnapshot } = await import('../pricingEngine.js');
    const replayed = replayPricingInputSnapshot(run.input_snapshot_json, run.input_hash);
    const persisted = await db.query<{ player_id: string; previous_price_cents: string; current_price_cents: string;
      fair_price_cents: string }>(`select player_id,previous_price_cents,current_price_cents,fair_price_cents
      from player_price_history order by player_id`);
    expect(replayed.map(quote => ({ id: quote.playerId, previous: quote.previousPriceCents,
      current: quote.currentPriceCents, fair: quote.fairPriceCents }))).toEqual(persisted.map(row => ({
      id: row.player_id, previous: Number(row.previous_price_cents),
      current: Number(row.current_price_cents), fair: Number(row.fair_price_cents),
    })));
    const price = await db.one<{ price_cents: string }>("select price_cents from tournament_players where player_id='player-a'");
    const repeated = await (await import('../postgres/economy.js')).recalculateLatestPricesPostgres(db);
    expect('idempotent' in repeated && repeated.idempotent).toBe(true);
    expect((await db.one<{ price_cents: string }>("select price_cents from tournament_players where player_id='player-a'")).price_cents).toBe(price.price_cents);
  }, 180_000);

  it('conflicto informativo conserva scoring y pricing', async () => {
    const deps = { db, ingest: async () => report([], 1) };
    expect((await runScheduledDataSync(deps)).stage).toBe('INGESTED');
    expect((await runScheduledDataSync(deps)).stage).toBe('RECONCILED');
    expect((await runScheduledDataSync(deps)).stage).toBe('SCORED');
    const priced = await runScheduledDataSync(deps);
    expect(priced.stage).toBe('PRICED');
    expect(priced.status).toBe('PARTIAL');
    expect((await db.one<{ count: number }>("select count(*)::int as count from pricing_runs where status='COMPLETED'")).count).toBe(1);
    expect((await db.one<{ count: number }>("select count(*)::int as count from pipeline_conflicts where severity='NON_BLOCKING'")).count).toBe(1);
  }, 120_000);

  it('conflicto de identidad aislado no bloquea el precio de datos deportivos confirmados', async () => {
    const input = report();
    input.publication.blocking = 1;
    input.publication.conflicts = [{ severity: 'BLOCKING', kind: 'PLAYER_IDENTITY',
      key: 'LPF|ambiguous-player', reason: 'qa', sources: ['LPF'] }];
    const deps = { db, ingest: async () => input };
    for (const expected of ['INGESTED','RECONCILED','SCORED','PRICED']) {
      expect((await runScheduledDataSync(deps)).stage).toBe(expected);
    }
    expect((await db.one<{ count: number }>("select count(*)::int as count from pricing_runs where status='COMPLETED'")).count).toBe(1);
  }, 120_000);

  it('conflicto de partido retira puntos antiguos, puntúa el partido sano y retiene pricing', async () => {
    const key = matchVerificationKey({ homeClub: 'Plaza Amador', awayClub: 'Tauro FC', startsAt: matchAt });
    const deps = { db, ingest: async () => report([key]) };
    expect((await runScheduledDataSync(deps)).stage).toBe('INGESTED');
    expect((await runScheduledDataSync(deps)).stage).toBe('RECONCILED');
    expect((await db.one<{ score_status: string }>("select score_status from matches where id='match-a'")).score_status).toBe('PENDING');
    expect((await runScheduledDataSync(deps)).stage).toBe('SCORED');
    expect((await db.one<{ count: number }>('select count(*)::int as count from player_fantasy_points')).count).toBe(1);
    expect((await runScheduledDataSync(deps)).stage).toBe('PARTIAL');
    expect((await db.one<{ count: number }>('select count(*)::int as count from pricing_runs')).count).toBe(0);
  }, 120_000);

  it('el lease evita dos crons simultáneos', async () => {
    let release!: () => void;
    let started!: () => void;
    const inside = new Promise<void>(resolve => { started = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const first = runScheduledDataSync({ db, ingest: async () => { started(); await hold; return report(); } });
    await inside;
    const second = await runScheduledDataSync({ db, ingest: async () => report() });
    expect(second.runId).toBe('already-running');
    release();
    expect((await first).stage).toBe('INGESTED');
  }, 120_000);

  it('reintenta una etapa fallida sin crear otro run ni duplicar scoring', async () => {
    await expect(runScheduledDataSync({ db, ingest: async () => { throw new Error('fuente temporalmente caída'); } }))
      .rejects.toThrow('fuente temporalmente caída');
    const failed = await db.one<{ id: string; stage: string; attempts: number; next_retry_at: string }>(
      'select id,stage,attempts,next_retry_at from pipeline_runs');
    expect(failed.stage).toBe('INGESTING');
    expect(failed.attempts).toBe(1);
    expect(Date.parse(failed.next_retry_at)).toBeGreaterThan(Date.now());
    await db.execute('update pipeline_runs set next_retry_at=now()-interval \'1 second\' where id=$1', [failed.id]);
    const recovered = await runScheduledDataSync({ db, ingest: async () => report() });
    expect(recovered.runId).toBe(failed.id);
    expect(recovered.stage).toBe('INGESTED');
    expect((await db.one<{ count: number }>('select count(*)::int as count from pipeline_runs')).count).toBe(1);
  }, 120_000);

  it('publica entidades en lotes reanudables con cursor durable', async () => {
    const input = report();
    const clubs = ['Atlético QA', 'Unión QA'].map((name, index) => ({
      kind: 'club' as const, name, normalizedName: name.toLowerCase(),
      external: { source: 'TRANSFERMARKT' as const, externalId: `qa-club-${index}`,
        sourceUrl: 'https://qa.invalid/club' },
    }));
    input.adapters[0].entities = clubs;
    input.reconciliation.accepted = clubs;
    input.publication.accepted = 2;
    input.publication.acceptedBySource = { TRANSFERMARKT: 2 };
    const deps = { db, ingest: async () => input, publishEntityBatchSize: 1 };
    expect((await runScheduledDataSync(deps)).stage).toBe('INGESTED');
    expect((await runScheduledDataSync(deps)).stage).toBe('PUBLISHING');
    expect((await db.one<{ entity_cursor: number }>('select entity_cursor from pipeline_ingest_payloads')).entity_cursor).toBe(1);
    expect((await runScheduledDataSync(deps)).stage).toBe('RECONCILED');
    expect((await db.one<{ count: number }>("select count(*)::int as count from club_external_ids where external_id like 'qa-club-%'")).count).toBe(2);
  }, 120_000);

  it('guarda observaciones en lote sin duplicarlas al reintentar', async () => {
    const value = { source: 'LPF' as const, entityType: 'verification' as const,
      externalEntityId: 'qa-observation', sourceUrl: 'https://qa.invalid/observation',
      parserVersion: 'qa', observedAt: new Date().toISOString(), contentHash: 'qa-hash',
      value: { confirmed: true } };
    const repository = createPostgresCanonicalDataRepository(db);
    await persistEntities(repository, [], [value, { ...value, externalEntityId: 'qa-observation-2' }]);
    await persistEntities(repository, [], [value]);
    expect((await db.one<{ count: number }>("select count(*)::int as count from source_observations where parser_version='qa'")).count).toBe(2);
  }, 120_000);

  it('cuarentena una coincidencia semántica sin crear ni fusionar otro jugador', async () => {
    const repository = createPostgresCanonicalDataRepository(db);
    const candidate = {
      kind: 'player' as const,
      fullName: 'Jugador A', displayName: 'Jugador A', normalizedName: 'jugador a',
      clubName: 'Plaza Amador', normalizedClubName: 'plaza amador', position: 'FWD' as const,
      dateOfBirth: null, nationality: 'Panamá', shirtNumber: 99, imageUrl: null,
      external: { source: 'LPF' as const, externalId: 'qa-player-a-lpf', sourceUrl: 'https://qa.invalid/player-a' },
    };
    await persistEntities(repository, [candidate], []);
    await persistEntities(repository, [candidate], []);
    expect((await db.one<{ count: number }>("select count(*)::int as count from players where normalized_name='jugador a'")).count).toBe(1);
    expect((await db.one<{ count: number }>("select count(*)::int as count from player_external_ids where source='LPF' and external_id='qa-player-a-lpf'")).count).toBe(0);
    expect((await db.one<{ count: number }>("select count(*)::int as count from player_identity_candidates where source='LPF' and external_id='qa-player-a-lpf'")).count).toBe(1);
  }, 120_000);

  it('cuarentena un cambio de posición vinculado y sus estadísticas hasta resolución explícita', async () => {
    await db.execute(`insert into player_external_ids(player_id,source,external_id,source_url,created_at,updated_at)
      values('player-a','LPF','qa-linked-player','https://qa.invalid/player-a',now(),now())`);
    await db.execute(`insert into match_external_ids(match_id,source,external_id,source_url,created_at,updated_at)
      values('match-a','LPF','qa-linked-match','https://qa.invalid/match-a',now(),now())`);
    const repository = createPostgresCanonicalDataRepository(db);
    await persistEntities(repository, [{
      kind: 'player' as const, fullName: 'Jugador A', displayName: 'Jugador A', normalizedName: 'jugador a',
      clubName: 'Plaza Amador', normalizedClubName: 'plaza amador', position: 'MID' as const,
      dateOfBirth: null, nationality: 'Panamá', shirtNumber: 9, imageUrl: null,
      external: { source: 'LPF' as const, externalId: 'qa-linked-player', sourceUrl: 'https://qa.invalid/player-a' },
    }], []);
    expect((await db.one<{ position: string }>("select position from players where id='player-a'")).position).toBe('FWD');
    expect((await db.one<{ count: number }>(`select count(*)::int as count from player_identity_candidates
      where source='LPF' and external_id='qa-linked-player' and status='PENDING'`)).count).toBe(1);
    await persistEntities(repository, [{
      kind: 'player_stat' as const,
      playerExternalId: 'qa-linked-player', matchExternalId: 'qa-linked-match',
      external: { source: 'LPF' as const, externalId: 'qa-linked-stat', sourceUrl: 'https://qa.invalid/stat' },
      starter: true, substituteIn: false, minutes: 90, goals: 9, assists: 0,
      yellowCards: 0, redCards: 0, ownGoals: 0, saves: 0, clubName: 'Plaza Amador',
    }], []);
    expect((await db.one<{ goals: number }>(`select goals from player_match_stats
      where player_id='player-a' and match_id='match-a'`)).goals).toBe(1);
  }, 120_000);

  it('una resolución aprobada vincula otra fuente al canónico sin duplicarlo', async () => {
    await db.execute(`insert into player_identity_resolutions(source,external_id,canonical_player_id,decision,
      evidence_summary,resolved_at,resolved_by) values('LPF','qa-resolved-player','player-a','SAME_PERSON','qa',now(),'qa')`);
    const repository = createPostgresCanonicalDataRepository(db);
    await persistEntities(repository, [{
      kind: 'player' as const,
      fullName: 'Jugador A', displayName: 'Jugador A', normalizedName: 'jugador a',
      clubName: 'Plaza Amador', normalizedClubName: 'plaza amador', position: 'FWD' as const,
      dateOfBirth: null, nationality: 'Panamá', shirtNumber: 9, imageUrl: null,
      external: { source: 'LPF' as const, externalId: 'qa-resolved-player', sourceUrl: 'https://qa.invalid/resolved' },
    }], []);
    expect((await db.one<{ count: number }>("select count(*)::int as count from players where normalized_name='jugador a'")).count).toBe(1);
    expect((await db.one<{ player_id: string }>("select player_id from player_external_ids where source='LPF' and external_id='qa-resolved-player'")).player_id).toBe('player-a');
  }, 120_000);

  it('una resolución de campo y un alias histórico no sobrescriben el canónico', async () => {
    await db.execute(`insert into player_field_resolutions(player_id,field_name,canonical_value,evidence_summary,resolved_at,resolved_by)
      values('player-a','position','MID','qa',now(),'qa')`);
    await db.execute("update players set position='MID' where id='player-a'");
    await db.execute(`insert into player_identity_resolutions(source,external_id,canonical_player_id,retired_player_id,
      decision,evidence_summary,resolved_at,resolved_by) values('LPF','qa-historic','player-a','player-b',
      'SAME_PERSON','qa',now(),'qa')`);
    await db.execute(`insert into player_external_ids(player_id,source,external_id,source_url,created_at,updated_at)
      values('player-a','LPF','qa-historic','https://qa.invalid/historic',now(),now())`);
    const repository = createPostgresCanonicalDataRepository(db);
    await persistEntities(repository, [{
      kind: 'player', fullName: 'Nombre Histórico', displayName: 'Nombre Histórico',
      normalizedName: 'nombre historico', clubName: 'Tauro FC', normalizedClubName: 'tauro',
      position: 'FWD', dateOfBirth: null, nationality: null, shirtNumber: null, imageUrl: null,
      external: { source: 'LPF', externalId: 'qa-historic', sourceUrl: 'https://qa.invalid/historic' },
    }], []);
    const player = await db.one<{ name: string; position: string; club_id: string }>(
      "select name,position,club_id from players where id='player-a'");
    expect(player).toEqual({ name: 'Jugador A', position: 'MID', club_id: 'club-a' });
  }, 120_000);

  it('expone al rol de aplicación la alerta de jornada vencida sin abrir las tablas internas', async () => {
    const status = await db.transaction(async tx => {
      await tx.execute('set local role fantasy_lpf_app');
      const row = await tx.one<{ status: { overdueGameweeks: Array<{ id: string }> } }>(
        'select app_pipeline_status() as status');
      return row.status;
    });
    expect(status.overdueGameweeks.map(gameweek => gameweek.id)).toContain('gw-1');
    await expect(db.transaction(async tx => {
      await tx.execute('set local role fantasy_lpf_app');
      await tx.query('select * from pipeline_runs');
    })).rejects.toThrow();
  }, 120_000);
});
