export * from './adapter.js';
export * from './completeness.js';
export * from './dbBridge.js';
export * from './http.js';
export * from './jobs.js';
export * from './normalization.js';
export * from './orchestrator.js';
export * from './reconciliation.js';
export * from './repository.js';
export * from './types.js';
export * from './verification.js';
export * from './adapters/lpf.js';
export * from './adapters/transfermarkt.js';
export * from './adapters/soccerway.js';
export * from './adapters/scores365.js';
export * from './adapters/fotmob.js';

import type { CanonicalDataRepository } from './repository.js';
import { IngestionOrchestrator } from './orchestrator.js';
import { LpfRosterAdapter } from './adapters/lpf.js';
import { TransfermarktRosterAdapter } from './adapters/transfermarkt.js';
import { SoccerwayAdapter } from './adapters/soccerway.js';
import { Scores365Adapter } from './adapters/scores365.js';
import { FotMobAdapter } from './adapters/fotmob.js';

export function createDefaultIngestionOrchestrator(repository?: CanonicalDataRepository): IngestionOrchestrator {
  return new IngestionOrchestrator([
    new LpfRosterAdapter(),
    new TransfermarktRosterAdapter(),
    new SoccerwayAdapter(),
    new Scores365Adapter(),
    new FotMobAdapter(),
  ], repository);
}
