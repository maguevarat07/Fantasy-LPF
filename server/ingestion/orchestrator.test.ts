import { describe, expect, it } from 'vitest';
import { IngestionOrchestrator } from './orchestrator.js';
import type { SourceAdapter } from './adapter.js';
import type { CanonicalDataRepository } from './repository.js';
import type { AdapterResult, NormalizedMatch, Source } from './types.js';

const at = '2026-09-14T01:00:00Z';
function match(source: Source, id: string, score: number, day = 14): NormalizedMatch {
  return { kind: 'match', tournamentId: 'apertura-2026', gameweekId: 'gw-1', gameweekNumber: 1,
    gameweekStatus: 'FINISHED', deadlineAt: at, scoreStatus: 'CONFIRMED',
    homeClub: 'Plaza Amador', awayClub: 'Tauro FC', startsAt: `2026-09-${day}T01:00:00Z`,
    homeScore: score, awayScore: 1, round: 'Jornada 1',
    external: { source, externalId: id, sourceUrl: 'https://example.test' } };
}
function adapter(source: Source, entities: NormalizedMatch[] = []): SourceAdapter {
  return { source, parserVersion: 'test', collect: async (): Promise<AdapterResult> => ({
    source, status: entities.length ? 'WORKING' : 'NOT_VERIFIED', parserVersion: 'test',
    startedAt: at, finishedAt: at, sourceUrls: [], entities, warnings: [], errors: [], httpStatuses: [],
    observations: entities.map(entity => ({ source, entityType: 'match',
      externalEntityId: entity.external.externalId, sourceUrl: entity.external.sourceUrl,
      parserVersion: 'test', observedAt: at, contentHash: entity.external.externalId, value: entity })),
  }) };
}
function repository() {
  const matches: string[] = [];
  const observations: string[] = [];
  const runs: string[] = [];
  const value: CanonicalDataRepository = {
    transaction: async work => work({
      upsertClub: async () => 'unchanged', upsertPlayer: async () => 'unchanged',
      upsertMatch: async entity => { matches.push(entity.external.externalId); return 'created'; },
      upsertPlayerStat: async () => 'unchanged',
      upsertObservation: async entity => { observations.push(entity.externalEntityId); return 'created'; },
    }),
    recordSyncRun: async run => { runs.push(run.runId); },
  };
  return { value, matches, observations, runs };
}

describe('orquestación con fuentes parciales', () => {
  it('conserva observaciones conflictivas y publica el partido sano', async () => {
    const storage = repository();
    const report = await new IngestionOrchestrator([
      adapter('TRANSFERMARKT', [match('TRANSFERMARKT', 'disputed', 2), match('TRANSFERMARKT', 'safe', 0, 15)]),
      adapter('FOTMOB', [match('FOTMOB', 'other-score', 1)]),
    ], storage.value).sync();
    expect(report.publication.blocking).toBe(1);
    expect(storage.matches).toEqual(['safe']);
    expect(storage.observations).toEqual(['disputed','safe','other-score']);
    expect(storage.runs).toHaveLength(3);
  });

  it('reintenta una fuente fallida sin perder otra fuente', async () => {
    let attempts = 0;
    const unstable: SourceAdapter = { source: 'FOTMOB', parserVersion: 'test', collect: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary network error');
      return adapter('FOTMOB', [match('FOTMOB', 'm2', 2, 15)]).collect();
    } };
    const report = await new IngestionOrchestrator([adapter('TRANSFERMARKT', [match('TRANSFERMARKT', 'm1', 2)]), unstable])
      .sync({ adapterTimeoutMs: 2000 });
    expect(attempts).toBe(2);
    expect(report.publication.accepted).toBe(2);
  });

  it('corta una fuente que excede su presupuesto sin detener publicación sana', async () => {
    const hanging: SourceAdapter = { source: 'FOTMOB', parserVersion: 'test',
      collect: () => new Promise<AdapterResult>(() => {}) };
    const started = Date.now();
    const report = await new IngestionOrchestrator([adapter('TRANSFERMARKT', [match('TRANSFERMARKT', 'safe', 2)]), hanging])
      .sync({ adapterTimeoutMs: 25 });
    expect(Date.now() - started).toBeLessThan(500);
    expect(report.adapters.find(value => value.source === 'FOTMOB')?.status).toBe('NOT_VERIFIED');
    expect(report.publication.nonBlocking).toBe(1);
    expect(report.publication.accepted).toBe(1);
  });
});
