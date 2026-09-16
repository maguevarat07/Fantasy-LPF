import { normalizeIdentity } from './normalization.js';
import type { AdapterResult, DataVerificationReport, MatchVerificationClaim, MatchVerificationGroup, Source } from './types.js';

const CLUB_ALIASES: Record<string, string> = {
  'alianza': 'alianza',
  'alianza fc': 'alianza',
  'arabe unido': 'arabe unido',
  'cd arabe unido': 'arabe unido',
  'cai': 'cai',
  'independiente de la chorrera': 'cai',
  'club atletico independiente': 'cai',
  'club deportivo universitario': 'universitario',
  'cd universitario': 'universitario',
  'herrera': 'herrera',
  'plaza amador': 'plaza amador',
  'cd plaza amador': 'plaza amador',
  'san francisco': 'san francisco',
  'sporting': 'sporting san miguelito',
  'sporting san miguelito': 'sporting san miguelito',
  'tauro': 'tauro',
  'umecit': 'umecit',
  'union cocle': 'union cocle',
  'veraguas united': 'veraguas united',
};

function clubKey(value: string): string {
  const normalized = normalizeIdentity(value);
  return CLUB_ALIASES[normalized] ?? normalized;
}

function asClaim(result: AdapterResult, value: unknown, externalId: string, sourceUrl: string): MatchVerificationClaim | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const home = row.home as { name?: unknown } | undefined;
  const away = row.away as { name?: unknown } | undefined;
  const homeClub = typeof row.homeClub === 'string' ? row.homeClub : typeof home?.name === 'string' ? home.name : null;
  const awayClub = typeof row.awayClub === 'string' ? row.awayClub : typeof away?.name === 'string' ? away.name : null;
  if (!homeClub || !awayClub || typeof row.startsAt !== 'string') return null;
  return {
    source: result.source, externalId, sourceUrl,
    homeClub, awayClub, startsAt: row.startsAt,
    homeScore: typeof row.homeScore === 'number' ? row.homeScore : null,
    awayScore: typeof row.awayScore === 'number' ? row.awayScore : null,
    status: typeof row.scoreStatus === 'string' ? row.scoreStatus : typeof row.state === 'string' ? row.state : 'UNKNOWN',
  };
}

function matchKey(claim: MatchVerificationClaim): string {
  // The kickoff date avoids mixing Apertura/Clausura rounds with the same number.
  const date = Number.isNaN(Date.parse(claim.startsAt)) ? claim.startsAt : new Date(claim.startsAt).toISOString().slice(0, 10);
  return `${date}|${clubKey(claim.homeClub)}|${clubKey(claim.awayClub)}`;
}

export function buildDataVerificationReport(results: AdapterResult[]): DataVerificationReport {
  const claims: MatchVerificationClaim[] = [];
  const counts: Partial<Record<Source, number>> = {};
  for (const result of results) {
    for (const observation of result.observations) {
      if (observation.entityType !== 'match') continue;
      const claim = asClaim(result, observation.value, observation.externalEntityId, observation.sourceUrl);
      if (!claim) continue;
      claims.push(claim);
      counts[result.source] = (counts[result.source] ?? 0) + 1;
    }
  }
  const grouped = new Map<string, MatchVerificationClaim[]>();
  for (const claim of claims) {
    const key = matchKey(claim);
    const group = grouped.get(key) ?? [];
    group.push(claim);
    grouped.set(key, group);
  }
  const groups: MatchVerificationGroup[] = [...grouped.entries()].map(([key, values]) => {
    const scored = values.filter(value => value.homeScore !== null && value.awayScore !== null);
    const distinctScores = new Set(scored.map(value => `${value.homeScore}:${value.awayScore}`));
    const distinctSources = new Set(values.map(value => value.source));
    const verdict: MatchVerificationGroup['verdict'] = distinctSources.size < 2 ? 'SINGLE_SOURCE'
      : distinctScores.size > 1 ? 'CONFLICT' : scored.length >= 2 ? 'AGREEMENT' : 'SINGLE_SOURCE';
    return { key, claims: values, verdict };
  }).sort((left, right) => left.key.localeCompare(right.key));
  const playerTotalClaimsBySource: Partial<Record<Source, number>> = {};
  for (const result of results) {
    const count = result.observations.filter(observation => observation.entityType === 'player_season_stat').length;
    if (count) playerTotalClaimsBySource[result.source] = count;
  }
  const transfermarkt = results.find(result => result.source === 'TRANSFERMARKT');
  const playerKeys = new Map<string, string>();
  for (const entity of transfermarkt?.entities ?? []) {
    if (entity.kind === 'player') playerKeys.set(entity.external.externalId, `${entity.normalizedName}|${clubKey(entity.clubName ?? '')}`);
  }
  const calculated = new Map<string, { goals: number; assists: number; yellowCards: number; redCards: number }>();
  for (const observation of transfermarkt?.observations ?? []) {
    if (observation.entityType !== 'player_stat' || !observation.value || typeof observation.value !== 'object') continue;
    const row = observation.value as Record<string, unknown>;
    const key = typeof row.playerExternalId === 'string' ? playerKeys.get(row.playerExternalId) : undefined;
    if (!key) continue;
    const total = calculated.get(key) ?? { goals: 0, assists: 0, yellowCards: 0, redCards: 0 };
    for (const field of ['goals', 'assists', 'yellowCards', 'redCards'] as const) total[field] += Number(row[field] ?? 0);
    calculated.set(key, total);
  }
  let playerTotalsCompared = 0;
  let playerFieldAgreements = 0;
  let playerFieldDifferences = 0;
  const lpf = results.find(result => result.source === 'LPF');
  for (const observation of lpf?.observations ?? []) {
    if (observation.entityType !== 'player_season_stat' || !observation.value || typeof observation.value !== 'object') continue;
    const row = observation.value as Record<string, unknown>;
    const totals = row.totals as Record<string, unknown> | undefined;
    if (typeof row.normalizedPlayerName !== 'string' || !totals) continue;
    const key = `${row.normalizedPlayerName}|${clubKey(typeof row.normalizedClubName === 'string' ? row.normalizedClubName : '')}`;
    const other = calculated.get(key);
    if (!other) continue;
    playerTotalsCompared += 1;
    for (const field of ['goals', 'assists', 'yellowCards', 'redCards'] as const) {
      if (typeof totals[field] !== 'number') continue;
      if (totals[field] === other[field]) playerFieldAgreements += 1; else playerFieldDifferences += 1;
    }
  }
  return {
    generatedAt: new Date().toISOString(), matchClaimsBySource: counts,
    agreements: groups.filter(group => group.verdict === 'AGREEMENT').length,
    conflicts: groups.filter(group => group.verdict === 'CONFLICT').length,
    singleSource: groups.filter(group => group.verdict === 'SINGLE_SOURCE').length,
    groups, playerTotalClaimsBySource, playerTotalsCompared, playerFieldAgreements, playerFieldDifferences,
  };
}
