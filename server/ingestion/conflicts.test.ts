import { describe, expect, it } from 'vitest';
import { classifyAndFilter } from './conflicts.js';
import { reconcileEntities } from './reconciliation.js';
import { buildDataVerificationReport } from './verification.js';
import type { AdapterResult, NormalizedMatch, NormalizedPlayer, NormalizedPlayerStat, Source } from './types.js';

const at = '2026-09-14T01:00:00Z';
function match(source: Source, id: string, homeScore: number): NormalizedMatch {
  return { kind: 'match', tournamentId: 'apertura-2026', gameweekId: 'gw-1', gameweekNumber: 1,
    gameweekStatus: 'FINISHED', deadlineAt: at, scoreStatus: 'CONFIRMED',
    homeClub: 'Plaza Amador', awayClub: 'Tauro FC', startsAt: at,
    homeScore, awayScore: 1, round: 'Jornada 1',
    external: { source, externalId: id, sourceUrl: 'https://example.test/match' } };
}
function player(source: Source, id: string, club: string): NormalizedPlayer {
  return { kind: 'player', fullName: 'José Rodríguez', displayName: 'José Rodríguez',
    normalizedName: 'jose rodriguez', clubName: club, normalizedClubName: club.toLowerCase(),
    position: 'FWD', dateOfBirth: null, nationality: null, shirtNumber: null, imageUrl: null,
    external: { source, externalId: id, sourceUrl: 'https://example.test/player' } };
}
function result(source: Source, entities: AdapterResult['entities'] = [],
  status: AdapterResult['status'] = 'WORKING'): AdapterResult {
  return { source, status, parserVersion: 'test', startedAt: at, finishedAt: at,
    sourceUrls: [], entities, warnings: [], errors: status === 'NOT_VERIFIED' ? ['timeout'] : [],
    httpStatuses: [], observations: entities.filter(entity => entity.kind === 'match').map(entity => ({
      source, entityType: 'match', externalEntityId: entity.external.externalId,
      sourceUrl: entity.external.sourceUrl, parserVersion: 'test', observedAt: at,
      contentHash: entity.external.externalId, value: entity,
    })) };
}
function classify(results: AdapterResult[]) {
  return classifyAndFilter(results, reconcileEntities(results.flatMap(value => value.entities)),
    buildDataVerificationReport(results));
}

describe('publicación parcial segura', () => {
  it('publica todos los datos sin conflictos', () => {
    const output = classify([result('TRANSFERMARKT', [match('TRANSFERMARKT', 'm1', 2)]),
      result('SOCCERWAY', [match('SOCCERWAY', 's1', 2)])]);
    expect(output.conflicts).toHaveLength(0);
    expect(output.accepted).toHaveLength(2);
  });

  it('fuente caída y metadata opcional no bloquean partidos confirmados', () => {
    const output = classify([result('TRANSFERMARKT', [match('TRANSFERMARKT', 'm1', 2)]),
      result('FOTMOB', [], 'NOT_VERIFIED'), result('365SCORES', [], 'NOT_VERIFIED')]);
    expect(output.conflicts).toHaveLength(2);
    expect(output.conflicts.every(conflict => conflict.severity === 'NON_BLOCKING')).toBe(true);
    expect(output.accepted).toHaveLength(1);
  });

  it('identidad incompatible retiene solo jugadores afectados', () => {
    const valid = player('TRANSFERMARKT', 'valid', 'Alianza');
    valid.fullName = 'Ana Pérez'; valid.normalizedName = 'ana perez';
    const output = classify([result('TRANSFERMARKT', [player('TRANSFERMARKT', 'p1', 'Tauro'), valid]),
      result('LPF', [player('LPF', 'p2', 'Plaza Amador')])]);
    expect(output.conflicts[0].kind).toBe('PLAYER_IDENTITY');
    expect(output.accepted).toEqual([valid]);
    expect(output.blockedPlayerExternalKeys).toContain('TRANSFERMARKT|p1');
  });

  it('marcador contradictorio retiene partido y estadísticas asociadas, no otro partido', () => {
    const disputed = match('TRANSFERMARKT', 'm1', 2);
    const other = { ...match('TRANSFERMARKT', 'm2', 0), startsAt: '2026-09-15T01:00:00Z' };
    const stat: NormalizedPlayerStat = { kind: 'player_stat', playerExternalId: 'p1',
      matchExternalId: 'm1', clubName: 'Plaza Amador', starter: true, substituteIn: false,
      minutes: 90, goals: 1, assists: 1, assistStatus: 'PENDING', yellowCards: 0,
      redCards: 0, ownGoals: 0, saves: 0,
      external: { source: 'TRANSFERMARKT', externalId: 'm1:p1', sourceUrl: 'https://example.test/report' } };
    const output = classify([result('TRANSFERMARKT', [disputed, other, stat]),
      result('FOTMOB', [match('FOTMOB', 'f1', 1)])]);
    expect(output.conflicts.some(conflict => conflict.kind === 'MATCH_RESULT')).toBe(true);
    expect(output.accepted).toEqual([other]);
    expect(output.quarantined).toBe(3);
  });

  it('descarta fecha de nacimiento inválida sin retener al jugador', () => {
    const value = player('LPF', 'p1', 'Tauro');
    value.dateOfBirth = 'agosto 12, 2024';
    const output = classify([result('LPF', [value])]);
    expect(output.accepted).toEqual([{ ...value, dateOfBirth: null }]);
    expect(output.conflicts).toContainEqual(expect.objectContaining({
      severity: 'NON_BLOCKING', kind: 'OPTIONAL_METADATA', key: 'invalid-birth-date:LPF',
    }));
  });
});
