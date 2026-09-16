import { randomUUID } from 'node:crypto';
import type { SourceAdapter } from './adapter.js';
import { buildCompletenessReport } from './completeness.js';
import { persistEntities, type CanonicalDataRepository } from './repository.js';
import { reconcileEntities } from './reconciliation.js';
import { buildDataVerificationReport } from './verification.js';
import type { AdapterResult, PersistenceResult, SourceStatus, SyncReport, SyncRunRecord } from './types.js';

function aggregateStatus(results: AdapterResult[]): SourceStatus {
  if (results.some((result) => result.status === 'WORKING')) return results.every((result) => result.status === 'WORKING') ? 'WORKING' : 'PARTIAL';
  if (results.some((result) => result.status === 'PARTIAL')) return 'PARTIAL';
  if (results.every((result) => result.status === 'BLOCKED')) return 'BLOCKED';
  return 'NOT_VERIFIED';
}

export class IngestionOrchestrator {
  constructor(
    private readonly adapters: SourceAdapter[],
    private readonly repository?: CanonicalDataRepository,
  ) {}

  async sync(): Promise<SyncReport> {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const settled = await Promise.allSettled(this.adapters.map((adapter) => adapter.collect()));
    const adapterResults: AdapterResult[] = settled.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      const adapter = this.adapters[index];
      const now = new Date().toISOString();
      return {
        source: adapter.source,
        status: 'NOT_VERIFIED',
        parserVersion: adapter.parserVersion,
        startedAt,
        finishedAt: now,
        sourceUrls: [],
        entities: [],
        observations: [],
        warnings: [],
        errors: [result.reason instanceof Error ? result.reason.message : String(result.reason)],
        httpStatuses: [],
      };
    });
    const reconciliation = reconcileEntities(adapterResults.flatMap((result) => result.entities));
    const verification = buildDataVerificationReport(adapterResults);
    let persistence: PersistenceResult = { created: 0, updated: 0 };

    if (this.repository) {
      // Incomplete player identities are retained as observations and reported,
      // but cannot safely become selectable canonical players.
      const persistable = reconciliation.accepted.filter((entity) => entity.kind !== 'player' || (entity.normalizedClubName && entity.position));
      persistence = await persistEntities(
        this.repository,
        persistable,
        adapterResults.flatMap((result) => result.observations),
      );
      for (const result of adapterResults) {
        await this.repository.recordSyncRun({
          runId: `${runId}:${result.source}`,
          source: result.source,
          job: 'canonical-sync',
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          status: result.status,
          recordsFound: result.entities.length + result.observations.length,
          recordsCreated: 0,
          recordsUpdated: 0,
          conflicts: reconciliation.conflicts.filter((conflict) => conflict.candidates.some((candidate) => candidate.external.source === result.source)).length
            + verification.groups.filter(group => group.verdict === 'CONFLICT' && group.claims.some(claim => claim.source === result.source)).length,
          errors: result.errors,
        });
      }
      const combinedRun: SyncRunRecord = {
        runId,
        source: 'ALL',
        job: 'canonical-sync',
        startedAt,
        finishedAt: new Date().toISOString(),
        status: aggregateStatus(adapterResults),
        recordsFound: reconciliation.accepted.length + adapterResults.reduce((sum, result) => sum + result.observations.length, 0),
        recordsCreated: persistence.created,
        recordsUpdated: persistence.updated,
        conflicts: reconciliation.conflicts.length + verification.conflicts,
        errors: adapterResults.flatMap((result) => result.errors),
      };
      await this.repository.recordSyncRun(combinedRun);
    }

    return {
      runId,
      adapters: adapterResults,
      reconciliation,
      persistence,
      completeness: buildCompletenessReport(adapterResults, reconciliation),
      verification,
    };
  }
}
