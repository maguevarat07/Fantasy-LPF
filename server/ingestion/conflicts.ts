import { matchVerificationKey } from './verification.js';
import type { AdapterResult, NormalizedEntity, ReconciliationResult, DataVerificationReport, Source } from './types.js';

export interface PipelineConflict {
  severity: 'BLOCKING' | 'NON_BLOCKING';
  kind: 'PLAYER_IDENTITY' | 'MATCH_RESULT' | 'MATCH_DATE' | 'SOURCE_UNAVAILABLE' | 'OPTIONAL_METADATA';
  key: string;
  reason: string;
  sources: Source[];
}

const identity = (entity: NormalizedEntity) => `${entity.kind}|${entity.external.source}|${entity.external.externalId}`;

/** Quarantine only claims whose identity or match result cannot be established. */
export function classifyAndFilter(
  results: AdapterResult[], reconciliation: ReconciliationResult, verification: DataVerificationReport,
): { accepted: NormalizedEntity[]; conflicts: PipelineConflict[]; quarantined: number;
  blockingMatchKeys: string[]; blockedPlayerExternalKeys: string[];
  acceptedBySource: Partial<Record<Source, number>> } {
  const conflicts: PipelineConflict[] = [];
  const blockedEntities = new Set<string>();
  const blockedPlayers = new Set<string>();
  const blockedMatches = new Set<string>();
  const blockingMatchKeys: string[] = [];
  const invalidBirthSources = new Set<Source>();
  for (const entity of reconciliation.accepted) {
    if (entity.kind === 'player' && entity.dateOfBirth && !Number.isFinite(Date.parse(entity.dateOfBirth))) {
      invalidBirthSources.add(entity.external.source);
    }
    if (entity.kind === 'match' && (!Number.isFinite(Date.parse(entity.deadlineAt))
      || (entity.startsAt && !Number.isFinite(Date.parse(entity.startsAt))))) {
      blockedEntities.add(identity(entity));
      blockedMatches.add(`${entity.external.source}|${entity.external.externalId}`);
      conflicts.push({ severity: 'BLOCKING', kind: 'MATCH_DATE', key: identity(entity),
        reason: 'La fecha del partido o su deadline no es verificable.', sources: [entity.external.source] });
    }
  }
  for (const source of invalidBirthSources) conflicts.push({ severity: 'NON_BLOCKING',
    kind: 'OPTIONAL_METADATA', key: `invalid-birth-date:${source}`,
    reason: 'Fechas de nacimiento inválidas descartadas; no afectan el scoring.', sources: [source] });
  for (const conflict of reconciliation.conflicts) {
    const sources = [...new Set(conflict.candidates.map(candidate => candidate.external.source))];
    const key = conflict.candidates.map(identity).sort().join('|');
    conflicts.push({ severity: 'BLOCKING', kind: 'PLAYER_IDENTITY', key, reason: conflict.reason, sources });
    for (const candidate of conflict.candidates) {
      blockedEntities.add(identity(candidate));
      if (candidate.kind === 'player') blockedPlayers.add(`${candidate.external.source}|${candidate.external.externalId}`);
    }
  }
  for (const group of verification.groups.filter(value => value.verdict === 'CONFLICT')) {
    conflicts.push({ severity: 'BLOCKING', kind: 'MATCH_RESULT', key: group.key,
      reason: 'Las fuentes publicaron marcadores incompatibles para el mismo partido.',
      sources: [...new Set(group.claims.map(claim => claim.source))] });
    blockingMatchKeys.push(group.key);
    for (const claim of group.claims) blockedMatches.add(`${claim.source}|${claim.externalId}`);
  }
  if (verification.playerFieldDifferences > 0) conflicts.push({ severity: 'NON_BLOCKING',
    kind: 'OPTIONAL_METADATA', key: 'season-totals',
    reason: `${verification.playerFieldDifferences} diferencias en acumulados no vinculados a partidos; no se usan para puntuar.`,
    sources: ['LPF', 'TRANSFERMARKT'] });
  for (const result of results) {
    if (result.status === 'BLOCKED' || result.status === 'NOT_VERIFIED') conflicts.push({ severity: 'NON_BLOCKING',
      kind: 'SOURCE_UNAVAILABLE', key: result.source,
      reason: result.errors.join('; ') || 'Fuente sin datos verificables en esta ejecución.', sources: [result.source] });
  }
  const accepted = reconciliation.accepted.filter(entity => {
    if (blockedEntities.has(identity(entity))) return false;
    if (entity.kind === 'match' && blockingMatchKeys.includes(matchVerificationKey({
      startsAt: entity.startsAt ?? '', homeClub: entity.homeClub, awayClub: entity.awayClub,
    }))) return false;
    if (entity.kind === 'player_stat' && (blockedPlayers.has(`${entity.external.source}|${entity.playerExternalId}`)
      || blockedMatches.has(`${entity.external.source}|${entity.matchExternalId}`))) return false;
    return true;
  }).map(entity => entity.kind === 'player' && entity.dateOfBirth
    && !Number.isFinite(Date.parse(entity.dateOfBirth)) ? { ...entity, dateOfBirth: null } : entity);
  const acceptedBySource: Partial<Record<Source, number>> = {};
  for (const entity of accepted) acceptedBySource[entity.external.source] = (acceptedBySource[entity.external.source] ?? 0) + 1;
  return { accepted, conflicts, quarantined: reconciliation.accepted.length - accepted.length,
    blockingMatchKeys, blockedPlayerExternalKeys: [...blockedPlayers], acceptedBySource };
}
