import { randomUUID } from 'node:crypto';
import type { SourceAdapter } from './adapter.js';
import { buildCompletenessReport } from './completeness.js';
import { persistEntities, type CanonicalDataRepository } from './repository.js';
import { reconcileEntities } from './reconciliation.js';
import { buildDataVerificationReport } from './verification.js';
import { classifyAndFilter } from './conflicts.js';
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

  async sync(options: {
    onStage?: (stage: 'INGESTED' | 'NORMALIZED' | 'RECONCILED') => Promise<void>;
    adapterTimeoutMs?: number;
  } = {}): Promise<SyncReport> {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const collect = async (adapter: SourceAdapter): Promise<AdapterResult> => {
      const budgetMs = options.adapterTimeoutMs ?? 180_000;
      const deadline = Date.now() + budgetMs;
      let last: AdapterResult | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const timeoutMs = deadline - Date.now();
        if (timeoutMs <= 0) break;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          last = await Promise.race([
            adapter.collect(),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error(`${adapter.source}: tiempo límite de ${timeoutMs} ms.`)), timeoutMs);
            }),
          ]);
          if (last.status !== 'NOT_VERIFIED') return last;
        } catch (error) {
          const finishedAt = new Date().toISOString();
          last = { source: adapter.source, status: 'NOT_VERIFIED', parserVersion: adapter.parserVersion,
            startedAt, finishedAt, sourceUrls: [], entities: [], observations: [], warnings: [],
            errors: [error instanceof Error ? error.message : String(error)], httpStatuses: [] };
        } finally { if (timer) clearTimeout(timer); }
        if (attempt === 0 && Date.now() + 500 < deadline) await new Promise(resolve => setTimeout(resolve, 500));
      }
      return last ?? { source: adapter.source, status: 'NOT_VERIFIED', parserVersion: adapter.parserVersion,
        startedAt, finishedAt: new Date().toISOString(), sourceUrls: [], entities: [], observations: [],
        warnings: [], errors: [`${adapter.source}: tiempo límite de ${budgetMs} ms.`], httpStatuses: [] };
    };
    const settled = await Promise.allSettled(this.adapters.map(collect));
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
    await options.onStage?.('INGESTED');
    const reconciliation = reconcileEntities(adapterResults.flatMap((result) => result.entities));
    const verification = buildDataVerificationReport(adapterResults);
    const publication = classifyAndFilter(adapterResults, reconciliation, verification);
    await options.onStage?.('NORMALIZED');
    let persistence: PersistenceResult = { created: 0, updated: 0 };

    if (this.repository) {
      // Incomplete player identities are retained as observations and reported,
      // but cannot safely become selectable canonical players.
      const persistable = publication.accepted.filter((entity) => entity.kind !== 'player' || (entity.normalizedClubName && entity.position));
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
        conflicts: publication.conflicts.length,
        errors: adapterResults.flatMap((result) => result.errors),
      };
      await this.repository.recordSyncRun(combinedRun);
    }

    await options.onStage?.('RECONCILED');

    return {
      runId,
      adapters: adapterResults,
      reconciliation,
      persistence,
      completeness: buildCompletenessReport(adapterResults, reconciliation),
      verification,
      publication: { accepted: publication.accepted.length, quarantined: publication.quarantined,
        blocking: publication.conflicts.filter(conflict => conflict.severity === 'BLOCKING').length,
        nonBlocking: publication.conflicts.filter(conflict => conflict.severity === 'NON_BLOCKING').length,
        conflicts: publication.conflicts, blockingMatchKeys: publication.blockingMatchKeys,
        blockedPlayerExternalKeys: publication.blockedPlayerExternalKeys,
        acceptedBySource: publication.acceptedBySource },
    };
  }
}
