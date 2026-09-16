import { describe, expect, it } from 'vitest';
import type { Player } from '../types/fantasy';
import { arrangeLineupForFormation } from './lineupFormation';

const makePlayer = (id: string, position: Player['position']): Player => ({ id, position } as Player);
const players = [
  makePlayer('gk1', 'GK'), makePlayer('gk2', 'GK'),
  ...Array.from({ length: 5 }, (_, index) => makePlayer(`def${index + 1}`, 'DEF')),
  ...Array.from({ length: 5 }, (_, index) => makePlayer(`mid${index + 1}`, 'MID')),
  ...Array.from({ length: 3 }, (_, index) => makePlayer(`fwd${index + 1}`, 'FWD')),
];

describe('arrangeLineupForFormation', () => {
  it('moves the required players between the XI and bench', () => {
    const result = arrangeLineupForFormation({
      formation: '3-4-3',
      starters: ['gk1', 'def1', 'def2', 'def3', 'def4', 'mid1', 'mid2', 'mid3', 'fwd1', 'fwd2', 'fwd3'],
      bench: ['gk2', 'def5', 'mid4', 'mid5'],
      players,
      captainId: 'fwd1',
      viceCaptainId: 'mid1',
    });

    const positions = result.starters.map(id => players.find(player => player.id === id)?.position);
    expect(positions.filter(position => position === 'GK')).toHaveLength(1);
    expect(positions.filter(position => position === 'DEF')).toHaveLength(3);
    expect(positions.filter(position => position === 'MID')).toHaveLength(4);
    expect(positions.filter(position => position === 'FWD')).toHaveLength(3);
    expect(result.bench).toHaveLength(4);
    expect(result.bench[0]).toBe('gk2');
  });

  it('keeps captaincy on players who remain in the XI', () => {
    const result = arrangeLineupForFormation({
      formation: '4-5-1',
      starters: ['gk1', 'def1', 'def2', 'def3', 'def4', 'mid1', 'mid2', 'mid3', 'fwd1', 'fwd2', 'fwd3'],
      bench: ['gk2', 'def5', 'mid4', 'mid5'],
      players,
      captainId: 'fwd2',
      viceCaptainId: 'mid1',
    });

    expect(result.starters).toContain('fwd2');
    expect(result.captainId).toBe('fwd2');
    expect(result.viceCaptainId).toBe('mid1');
  });
});
