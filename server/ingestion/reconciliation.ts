import { normalizeIdentity } from './normalization.ts';
import type { IdentityConflict, NormalizedEntity, NormalizedPlayer, ReconciliationResult, Source } from './types.ts';

const SOURCE_PRIORITY: Record<Source, number> = { TRANSFERMARKT: 0, LPF: 1, SOCCERWAY: 2, FOTMOB: 3, '365SCORES': 4 };

function playerMatchKey(player: NormalizedPlayer): string | null {
  if (!player.normalizedName || !player.normalizedClubName || !player.position) return null;
  return `${player.normalizedName}|${player.normalizedClubName}|${player.position}`;
}

function prefer<T extends NormalizedEntity>(left: T, right: T): T {
  return SOURCE_PRIORITY[left.external.source] <= SOURCE_PRIORITY[right.external.source] ? left : right;
}

export function reconcileEntities(entities: NormalizedEntity[]): ReconciliationResult {
  const accepted: NormalizedEntity[] = [];
  const conflicts: IdentityConflict[] = [];
  const potentialDuplicates: ReconciliationResult['potentialDuplicates'] = [];
  const exactExternal = new Map<string, NormalizedEntity>();
  const playersByStrongKey = new Map<string, NormalizedPlayer>();
  const playersByName = new Map<string, NormalizedPlayer[]>();

  for (const entity of entities) {
    const externalKey = `${entity.kind}|${entity.external.source}|${entity.external.externalId}`;
    const priorExternal = exactExternal.get(externalKey);
    if (priorExternal) {
      const winner = prefer(priorExternal, entity);
      exactExternal.set(externalKey, winner);
      const index = accepted.indexOf(priorExternal);
      if (index >= 0) accepted[index] = winner;
      continue;
    }
    exactExternal.set(externalKey, entity);

    if (entity.kind !== 'player') {
      accepted.push(entity);
      continue;
    }

    const strongKey = playerMatchKey(entity);
    if (strongKey) {
      const prior = playersByStrongKey.get(strongKey);
      if (prior) {
        potentialDuplicates.push({ left: prior, right: entity, reason: 'Mismo nombre normalizado, club y posición en fuentes distintas.' });
        // Keep both observations/external IDs for persistence. The repository may
        // link them to one canonical player transactionally.
      } else {
        playersByStrongKey.set(strongKey, entity);
      }
    }

    const sameName = playersByName.get(entity.normalizedName) ?? [];
    for (const candidate of sameName) {
      const clubDisagrees = candidate.normalizedClubName && entity.normalizedClubName && candidate.normalizedClubName !== entity.normalizedClubName;
      const positionDisagrees = candidate.position && entity.position && candidate.position !== entity.position;
      if (clubDisagrees || positionDisagrees) {
        conflicts.push({ entityType: 'player', reason: `Nombre coincidente con ${clubDisagrees ? 'club' : 'posición'} incompatible; requiere revisión.`, candidates: [candidate, entity] });
      }
    }
    sameName.push(entity);
    playersByName.set(entity.normalizedName, sameName);
    accepted.push(entity);
  }
  return { accepted, conflicts, potentialDuplicates };
}

export function canonicalClubKey(name: string): string {
  return normalizeIdentity(name);
}
