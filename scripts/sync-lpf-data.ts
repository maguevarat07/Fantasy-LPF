import 'dotenv/config';
import { createDefaultIngestionOrchestrator } from '../server/ingestion/index.ts';
import type { CanonicalDataRepository } from '../server/ingestion/repository.ts';

type DatabaseHandle = {
  exec(sql: string): void;
  prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; run(...params: unknown[]): { changes: number } };
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
};
let databaseHandle: DatabaseHandle | undefined;

async function loadRepository(): Promise<CanonicalDataRepository> {
  const databaseModule = await import('../server/db.ts');
  const module = databaseModule as {
    canonicalDataRepository?: CanonicalDataRepository | ((database: unknown) => CanonicalDataRepository);
    openDatabase?: () => DatabaseHandle;
    migrate?: (database: unknown) => void;
    seedTournament?: (database: unknown, tournament: { id: string; name: string; status: 'ACTIVE' }) => void;
  };
  if (typeof module.canonicalDataRepository === 'function' && module.openDatabase) {
    const database = module.openDatabase();
    module.migrate?.(database);
    module.seedTournament?.(database, { id: 'apertura-2026', name: 'Apertura 2026', status: 'ACTIVE' });
    databaseHandle = database;
    return module.canonicalDataRepository(database);
  }
  if (module.canonicalDataRepository && typeof module.canonicalDataRepository !== 'function') return module.canonicalDataRepository;
  {
    throw new Error('server/db.ts debe exportar canonicalDataRepository implementando el contrato de server/ingestion/repository.ts. Usa --dry-run para adquirir y analizar sin escribir.');
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const full = process.argv.includes('--full');
  const repository = dryRun ? undefined : await loadRepository();
  const report = await createDefaultIngestionOrchestrator(repository).sync();
  if (databaseHandle) {
    // The orchestrator quarantines disputed entities while retaining all source
    // observations. Confirmed matches and players may continue through scoring.
    // A brand-new player enters at their position's baseline price; recalculatePlayerPrices
    // below then adjusts every player (new or existing) from their scored performance.
    databaseHandle.exec(`
      INSERT OR IGNORE INTO tournament_players (tournament_id, player_id, price_cents, active)
      SELECT 'apertura-2026', id,
        CASE position WHEN 'GK' THEN 400000000 WHEN 'DEF' THEN 400000000
          WHEN 'MID' THEN 450000000 WHEN 'FWD' THEN 500000000 END,
        active
      FROM players WHERE club_id IS NOT NULL AND position IN ('GK','DEF','MID','FWD');
    `);
    const transfermarkt = report.adapters.find(adapter => adapter.source === 'TRANSFERMARKT');
    const blockedPlayers = new Set(report.publication.blockedPlayerExternalKeys);
    const registeredPlayers = transfermarkt?.entities.filter(entity => entity.kind === 'player'
      && !blockedPlayers.has(`${entity.external.source}|${entity.external.externalId}`)) ?? [];
    const registeredClubs = new Set(registeredPlayers.map(player => player.kind === 'player' ? player.normalizedClubName : null).filter(Boolean));
    if (transfermarkt?.status === 'WORKING' && registeredClubs.size === 12 && registeredPlayers.length >= 180) {
      const syncedAt = transfermarkt.finishedAt;
      databaseHandle.transaction(() => {
        const findPlayer = databaseHandle!.prepare(`SELECT p.id AS playerId, p.club_id AS clubId
          FROM player_external_ids x JOIN players p ON p.id = x.player_id
          WHERE x.source = 'TRANSFERMARKT' AND x.external_id = ?`);
        const saveRegistration = databaseHandle!.prepare(`INSERT INTO tournament_roster_registrations
          (tournament_id, player_id, source, club_id, first_seen_at, last_seen_at, ended_at, active)
          VALUES ('apertura-2026', ?, 'TRANSFERMARKT', ?, ?, ?, NULL, 1)
          ON CONFLICT(tournament_id, player_id, source) DO UPDATE SET club_id = excluded.club_id,
            last_seen_at = excluded.last_seen_at, ended_at = NULL, active = 1`);
        for (const player of registeredPlayers) {
          if (player.kind !== 'player') continue;
          const canonical = findPlayer.get(player.external.externalId) as { playerId: string; clubId: string } | undefined;
          if (canonical) saveRegistration.run(canonical.playerId, canonical.clubId, syncedAt, syncedAt);
        }
        if (![...blockedPlayers].some(key => key.startsWith('TRANSFERMARKT|'))) {
          databaseHandle!.prepare(`UPDATE tournament_roster_registrations SET active = 0, ended_at = ?
            WHERE tournament_id = 'apertura-2026' AND source = 'TRANSFERMARKT'
              AND active = 1 AND last_seen_at <> ?`).run(syncedAt, syncedAt);
          databaseHandle!.exec(`UPDATE tournament_players SET active = CASE WHEN player_id IN (
            SELECT player_id FROM tournament_roster_registrations
            WHERE tournament_id = 'apertura-2026' AND source = 'TRANSFERMARKT' AND active = 1
          ) THEN 1 ELSE 0 END WHERE tournament_id = 'apertura-2026';`);
        }
      })();
    }
    const { recalculateGameweek } = await import('../server/scoring.ts');
    const finishedGameweeks = databaseHandle.prepare(`SELECT id FROM gameweeks WHERE status = 'FINISHED' ORDER BY week_number`).all() as Array<{ id: string }>;
    for (const gameweek of finishedGameweeks) {
      recalculateGameweek(databaseHandle as never, gameweek.id);
    }
    const { recalculatePlayerPrices } = await import('../server/pricing.ts');
    if (report.publication.blocking === 0) recalculatePlayerPrices(databaseHandle as never);
  }
  const output = full ? { dryRun, ...report } : {
    dryRun,
    runId: report.runId,
    sources: report.adapters.map(({ source, status, sourceUrls, httpStatuses, entities, observations, warnings, errors }) => ({
      source, status, sourceUrls, httpStatuses, entities: entities.length, observations: observations.length, warnings, errors,
    })),
    persistence: report.persistence,
    publication: report.publication,
    completeness: report.completeness,
    verification: {
      matchClaimsBySource: report.verification.matchClaimsBySource,
      agreements: report.verification.agreements,
      conflicts: report.verification.conflicts,
      singleSource: report.verification.singleSource,
      playerTotalClaimsBySource: report.verification.playerTotalClaimsBySource,
      playerTotalsCompared: report.verification.playerTotalsCompared,
      playerFieldAgreements: report.verification.playerFieldAgreements,
      playerFieldDifferences: report.verification.playerFieldDifferences,
      conflictDetails: report.verification.groups.filter(group => group.verdict === 'CONFLICT'),
    },
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  const official = report.adapters.find((adapter) => adapter.source === 'LPF');
  if (!official || official.status === 'BLOCKED' || official.status === 'NOT_VERIFIED' || report.completeness.playersDetected === 0) process.exitCode = 2;
  databaseHandle?.close();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
