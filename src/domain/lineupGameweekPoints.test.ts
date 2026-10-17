import { describe, expect, it } from 'vitest';
import { lineupGameweekPoints } from './lineupGameweekPoints';

describe('latest gameweek lineup display', () => {
  it('shows the published player points instead of an older team score', () => {
    const players = [
      { id: 'def', lastGwPoints: 1 },
      { id: 'mid', lastGwPoints: -1 },
      { id: 'fwd', lastGwPoints: 6 },
      { id: 'gk', lastGwPoints: 0 },
    ];
    expect(lineupGameweekPoints(['def', 'mid', 'fwd', 'gk'], 'def', players)).toBe(7);
  });

  it('keeps a real zero instead of falling back to the previous week', () => {
    expect(lineupGameweekPoints(['gk'], 'gk', [{ id: 'gk', lastGwPoints: 0 }])).toBe(0);
    expect(lineupGameweekPoints([], 'gk', [])).toBeNull();
  });
});
