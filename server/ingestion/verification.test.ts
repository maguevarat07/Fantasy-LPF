import { describe, expect, it } from 'vitest';
import { buildDataVerificationReport } from './verification.js';
import type { AdapterResult, Source } from './types.js';

function result(source: Source, homeScore: number, awayScore: number): AdapterResult {
  const value = { homeClub: 'CD Plaza Amador', awayClub: 'Tauro FC', startsAt: '2026-09-14T01:00:00Z', homeScore, awayScore, scoreStatus: 'CONFIRMED' };
  return { source, status: 'PARTIAL', parserVersion: 'test', startedAt: '', finishedAt: '', sourceUrls: [], entities: [], warnings: [], errors: [], httpStatuses: [200], observations: [{ source, entityType: 'match', externalEntityId: `${source}-1`, sourceUrl: 'https://example.test', parserVersion: 'test', observedAt: '', contentHash: source, value }] };
}

describe('buildDataVerificationReport', () => {
  it('recognizes agreements across club aliases', () => {
    const report = buildDataVerificationReport([result('TRANSFERMARKT', 2, 1), result('SOCCERWAY', 2, 1)]);
    expect(report.agreements).toBe(1);
    expect(report.conflicts).toBe(0);
  });

  it('surfaces score conflicts instead of silently choosing one source', () => {
    const report = buildDataVerificationReport([result('TRANSFERMARKT', 2, 1), result('FOTMOB', 1, 1)]);
    expect(report.conflicts).toBe(1);
    expect(report.groups[0].claims).toHaveLength(2);
  });
});
