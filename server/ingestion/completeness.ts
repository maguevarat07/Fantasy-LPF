import type { AdapterResult, CompletenessReport, NormalizedEntity, NormalizedPlayer, ReconciliationResult, Source } from './types.ts';

export function buildCompletenessReport(adapters: AdapterResult[], reconciliation: ReconciliationResult): CompletenessReport {
  const players = reconciliation.accepted.filter((entity): entity is NormalizedPlayer => entity.kind === 'player');
  const clubs = new Set<string>();
  const activePlayersByClub: Record<string, number> = {};
  const sourcesByStrongPlayer = new Map<string, Set<Source>>();
  for (const player of players) {
    if (player.clubName) {
      clubs.add(player.normalizedClubName ?? player.clubName);
      activePlayersByClub[player.clubName] = (activePlayersByClub[player.clubName] ?? 0) + 1;
    }
    const key = `${player.normalizedName}|${player.normalizedClubName ?? ''}|${player.position ?? ''}`;
    const sources = sourcesByStrongPlayer.get(key) ?? new Set<Source>();
    sources.add(player.external.source);
    sourcesByStrongPlayer.set(key, sources);
  }
  const sourceStatus = Object.fromEntries(adapters.map((adapter) => [adapter.source, adapter.status])) as Record<Source, AdapterResult['status']>;
  for (const source of ['LPF', 'TRANSFERMARKT', 'SOCCERWAY', '365SCORES', 'FOTMOB'] as const) sourceStatus[source] ??= 'NOT_VERIFIED';
  const warnings = adapters.flatMap((adapter) => adapter.warnings.map((warning) => `${adapter.source}: ${warning}`));
  if (!players.length) warnings.push('No se detectaron jugadores; la sincronización no debe desactivar registros existentes.');
  return {
    generatedAt: new Date().toISOString(),
    clubsDetected: clubs.size,
    playersDetected: players.length,
    activePlayersByClub,
    playersWithoutPosition: players.filter((player) => !player.position).length,
    playersWithoutClub: players.filter((player) => !player.clubName).length,
    potentialDuplicates: reconciliation.potentialDuplicates.length,
    playersOnlyInOneSource: [...sourcesByStrongPlayer.values()].filter((sources) => sources.size === 1).length,
    identityConflicts: reconciliation.conflicts.length,
    unresolvedPlayers: players.filter((player) => !player.normalizedName || !player.clubName || !player.position).length,
    demoPlayersDetected: null,
    sourceStatus,
    warnings,
  };
}

export function countKind(entities: NormalizedEntity[], kind: NormalizedEntity['kind']): number {
  return entities.filter((entity) => entity.kind === kind).length;
}
