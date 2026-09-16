import { expect, test } from 'vitest';
import { normalizeIdentity, normalizePosition } from './normalization.ts';
import { reconcileEntities } from './reconciliation.ts';
import type { NormalizedPlayer } from './types.ts';

test('normaliza tildes, clubes y posiciones Fantasy', () => {
  expect(normalizeIdentity('Tauro F.C.')).toBe('tauro');
  expect(normalizeIdentity(' José  Rodríguez ')).toBe('jose rodriguez');
  expect(normalizePosition('Portero')).toBe('GK');
  expect(normalizePosition('Mediocampista')).toBe('MID');
  expect(normalizePosition('posición desconocida')).toBe(null);
});

function player(source: NormalizedPlayer['external']['source'], externalId: string, club: string, position: NormalizedPlayer['position']): NormalizedPlayer {
  return {
    kind: 'player', fullName: 'José Rodríguez', displayName: 'José Rodríguez', normalizedName: 'jose rodriguez',
    clubName: club, normalizedClubName: normalizeIdentity(club), position, dateOfBirth: null, nationality: null,
    shirtNumber: null, imageUrl: null, external: { source, externalId, sourceUrl: `https://example.test/${externalId}` },
  };
}

test('marca coincidencias fuertes como potencial duplicado, sin fusionar a ciegas', () => {
  const result = reconcileEntities([player('LPF', '1', 'Tauro FC', 'DEF'), player('FOTMOB', '2', 'Tauro', 'DEF')]);
  expect(result.potentialDuplicates.length).toBe(1);
  expect(result.accepted.length).toBe(2);
});

test('manda identidades incompatibles a conflicto', () => {
  const result = reconcileEntities([player('LPF', '1', 'Tauro', 'DEF'), player('SOCCERWAY', '2', 'Plaza Amador', 'FWD')]);
  expect(result.conflicts.length).toBe(1);
});
