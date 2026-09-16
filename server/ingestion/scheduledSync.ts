import { randomUUID } from 'node:crypto';
import { createDefaultIngestionOrchestrator } from './index.js';
import type { SyncReport } from './types.js';
import { getPostgresDatabase } from '../postgres/client.js';
import { createPostgresCanonicalDataRepository } from '../postgres/canonicalRepository.js';
import { recalculateGameweekPostgres, recalculateLatestPricesPostgres } from '../postgres/economy.js';

export interface ScheduledDataSyncResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  status: 'WORKING' | 'PARTIAL';
}

export class ScheduledSyncUnavailableError extends Error {
  constructor() {
    super('La sincronización de producción espera la conexión PostgreSQL/Supabase.');
    this.name = 'ScheduledSyncUnavailableError';
  }
}

export async function runScheduledDataSync(): Promise<ScheduledDataSyncResult> {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) throw new ScheduledSyncUnavailableError();
  const db = getPostgresDatabase();
  const owner = randomUUID();
  const startedAt = new Date().toISOString();
  const lease = await db.query<{ owner: string }>(`insert into sync_leases(name,owner,acquired_at,expires_at)
    values('canonical-data',$1,now(),now()+interval '20 minutes')
    on conflict(name) do update set owner=excluded.owner,acquired_at=excluded.acquired_at,
      expires_at=excluded.expires_at where sync_leases.expires_at < now() returning owner`, [owner]);
  if (!lease.length) {
    return { runId: 'already-running', startedAt, finishedAt: new Date().toISOString(), status: 'PARTIAL' };
  }
  try {
    const report = await createDefaultIngestionOrchestrator(createPostgresCanonicalDataRepository(db)).sync();
    if (report.verification.conflicts > 0) {
      throw new Error(`La reconciliación detectó ${report.verification.conflicts} conflictos entre fuentes.`);
    }
    await updateTournamentRoster(db, report);
    const finished = await db.query<{ id: string }>("select id from gameweeks where status='FINISHED' order by week_number");
    for (const gameweek of finished) await recalculateGameweekPostgres(db, gameweek.id);
    await recalculateLatestPricesPostgres(db);
    const status = report.adapters.every(adapter => adapter.status === 'WORKING') ? 'WORKING' : 'PARTIAL';
    return { runId: report.runId, startedAt, finishedAt: new Date().toISOString(), status };
  } finally {
    await db.execute('delete from sync_leases where name=$1 and owner=$2', ['canonical-data', owner]);
  }
}

async function updateTournamentRoster(db: ReturnType<typeof getPostgresDatabase>, report: SyncReport): Promise<void> {
  await db.execute(`insert into tournament_players(tournament_id,player_id,price_cents,active)
    select 'apertura-2026',id,case position when 'GK' then 400000000 when 'DEF' then 400000000
      when 'MID' then 450000000 when 'FWD' then 500000000 end,active
    from players where club_id is not null and position in ('GK','DEF','MID','FWD')
    on conflict(tournament_id,player_id) do nothing`);
  const transfermarkt = report.adapters.find(adapter => adapter.source === 'TRANSFERMARKT');
  const registered = transfermarkt?.entities.filter(entity => entity.kind === 'player') ?? [];
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
    await tx.execute(`update tournament_roster_registrations set active=false,ended_at=$1
      where tournament_id='apertura-2026' and source='TRANSFERMARKT' and active=true and last_seen_at<>$1`,
    [transfermarkt.finishedAt]);
    await tx.execute(`update tournament_players set active=exists(select 1 from tournament_roster_registrations r
      where r.tournament_id='apertura-2026' and r.source='TRANSFERMARKT' and r.active=true
        and r.player_id=tournament_players.player_id) where tournament_id='apertura-2026'`);
  });
}
