export * from './adapter.ts';
export * from './completeness.ts';
export * from './dbBridge.ts';
export * from './http.ts';
export * from './jobs.ts';
export * from './normalization.ts';
export * from './orchestrator.ts';
export * from './reconciliation.ts';
export * from './repository.ts';
export * from './types.ts';
export * from './verification.ts';
export * from './adapters/lpf.ts';
export * from './adapters/transfermarkt.ts';
export * from './adapters/soccerway.ts';
export * from './adapters/scores365.ts';
export * from './adapters/fotmob.ts';

import type { CanonicalDataRepository } from './repository.ts';
import { IngestionOrchestrator } from './orchestrator.ts';
import { LpfRosterAdapter } from './adapters/lpf.ts';
import { TransfermarktRosterAdapter } from './adapters/transfermarkt.ts';
import { SoccerwayAdapter } from './adapters/soccerway.ts';
import { Scores365Adapter } from './adapters/scores365.ts';
import { FotMobAdapter } from './adapters/fotmob.ts';

export function createDefaultIngestionOrchestrator(repository?: CanonicalDataRepository): IngestionOrchestrator {
  return new IngestionOrchestrator([
    new LpfRosterAdapter(),
    new TransfermarktRosterAdapter(),
    new SoccerwayAdapter(),
    new Scores365Adapter(),
    new FotMobAdapter(),
  ], repository);
}
