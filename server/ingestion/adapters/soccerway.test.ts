import { describe, expect, it } from 'vitest';
import { extractSoccerwayFeeds, parseSoccerwayMatches } from './soccerway.ts';

const PAGE = `<script>
cjs.initialFeeds["summary-results"] = { data: \`SA÷1¬~AA÷match-finished¬AD÷1770000000¬AB÷3¬AF÷Tauro¬AE÷Plaza Amador¬ER÷Jornada 4¬AG÷2¬AH÷1¬~AA÷invalid-no-round¬AD÷1770000000¬AB÷3¬AF÷A¬AE÷B¬AG÷1¬AH÷0¬\` };
cjs.initialFeeds["summary-fixtures"] = { data: \`SA÷1¬~AA÷match-pending¬AD÷1890000000¬AB÷1¬AF÷CAI¬AE÷Alianza¬ER÷Jornada 9¬\` };
</script>`;

describe('Soccerway initial feed parser', () => {
  it('extracts the public result and fixture feeds', () => {
    expect(extractSoccerwayFeeds(PAGE)).toHaveLength(2);
  });

  it('normalizes completed and pending matches without inventing events', () => {
    const matches = parseSoccerwayMatches(PAGE, 'https://es.soccerway.com/panama/lpf/');
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ external: { source: 'SOCCERWAY', externalId: 'match-finished' }, gameweekNumber: 4, homeClub: 'Tauro', awayClub: 'Plaza Amador', homeScore: 2, awayScore: 1, scoreStatus: 'CONFIRMED', gameweekStatus: 'FINISHED' });
    expect(matches[1]).toMatchObject({ external: { externalId: 'match-pending' }, gameweekNumber: 9, homeScore: null, awayScore: null, scoreStatus: 'PENDING', gameweekStatus: 'OPEN' });
  });
});
