import { describe, expect, it } from 'vitest';
import { parseFotMobLeaguePage } from './fotmob.ts';

function page(allMatches: unknown): string {
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { fixtures: { allMatches } } },
  })}</script></html>`;
}

describe('FotMob LPF parser', () => {
  it('extracts finished and scheduled fixtures', () => {
    const matches = parseFotMobLeaguePage(page([
      { id: '5132455', round: '1', pageUrl: '/matches/a-vs-b/x#5132455',
        home: { id: '1', name: 'Veraguas United' }, away: { id: '2', name: 'CD Universitario' },
        status: { utcTime: '2026-01-17T01:30:00Z', finished: true, started: true,
          scoreStr: '1 - 2', reason: { long: 'Full-Time' } } },
      { id: 5954333, roundName: 9, home: { id: 3, name: 'Tauro FC' }, away: { id: 4, name: 'Alianza FC' },
        status: { utcTime: '2026-03-20T00:00:00Z', finished: false, started: false } },
    ]), 'https://www.fotmob.com/leagues/9039/matches/lpf');
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ matchId: '5132455', round: '1', homeScore: 1, awayScore: 2,
      state: 'FINISHED', statusText: 'Full-Time' });
    expect(matches[0].sourceUrl).toBe('https://www.fotmob.com/matches/a-vs-b/x#5132455');
    expect(matches[1]).toMatchObject({ matchId: '5954333', round: '9', homeScore: null, awayScore: null,
      state: 'SCHEDULED' });
  });

  it('rejects malformed payloads and incomplete identities', () => {
    expect(parseFotMobLeaguePage('<html></html>')).toEqual([]);
    expect(parseFotMobLeaguePage('<script id="__NEXT_DATA__">{bad</script>')).toEqual([]);
    expect(parseFotMobLeaguePage(page([{ id: '1', home: { name: 'A' } }]))).toEqual([]);
  });
});
