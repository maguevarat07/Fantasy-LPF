import { describe, expect, it } from 'vitest';
import { parse365ScoresGames } from './scores365.js';

describe('parse365ScoresGames', () => {
  it('normalizes a completed LPF game', () => {
    const result = parse365ScoresGames({ games: [{ id: 4773272, competitionId: 5809, roundNum: 8,
      startTime: '2026-09-14T20:00:00-05:00', statusGroup: 4,
      homeCompetitor: { name: 'Sporting San Miguelito', score: 0 },
      awayCompetitor: { name: 'San Francisco FC', score: 2 } }] }, 'https://webws.365scores.test');
    expect(result).toEqual([expect.objectContaining({ matchId: '4773272', round: 8,
      homeClub: 'Sporting San Miguelito', awayClub: 'San Francisco FC',
      homeScore: 0, awayScore: 2, scoreStatus: 'CONFIRMED' })]);
  });

  it('ignores records from another competition', () => {
    expect(parse365ScoresGames({ games: [{ id: 1, competitionId: 1 }] }, 'https://example.test')).toEqual([]);
  });
});
