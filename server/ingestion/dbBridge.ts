import type { CanonicalDataRepository, CanonicalDataTransaction } from './repository.js';
import type { SourceObservation, SyncRunRecord } from './types.js';

type UpsertResult = 'created' | 'updated' | 'unchanged';

/** Minimal bridge surface the backend can implement around server/db.ts. */
export interface DatabaseIngestionPort {
  withTransaction<T>(work: (databaseTx: unknown) => Promise<T>): Promise<T>;
  upsertCanonicalClub(tx: unknown, value: Parameters<CanonicalDataTransaction['upsertClub']>[0]): Promise<UpsertResult>;
  upsertCanonicalPlayer(tx: unknown, value: Parameters<CanonicalDataTransaction['upsertPlayer']>[0]): Promise<UpsertResult>;
  upsertCanonicalMatch(tx: unknown, value: Parameters<CanonicalDataTransaction['upsertMatch']>[0]): Promise<UpsertResult>;
  upsertCanonicalPlayerStat(tx: unknown, value: Parameters<CanonicalDataTransaction['upsertPlayerStat']>[0]): Promise<UpsertResult>;
  upsertCanonicalLineupEntry?(tx: unknown, value: Parameters<NonNullable<CanonicalDataTransaction['upsertLineupEntry']>>[0]): Promise<UpsertResult>;
  upsertCanonicalMatchEvent?(tx: unknown, value: Parameters<NonNullable<CanonicalDataTransaction['upsertMatchEvent']>>[0]): Promise<UpsertResult>;
  upsertSourceObservation(tx: unknown, value: SourceObservation): Promise<'created' | 'unchanged'>;
  insertSyncRun(value: SyncRunRecord): Promise<void>;
}

export function createCanonicalDataRepository(port: DatabaseIngestionPort): CanonicalDataRepository {
  return {
    transaction: (work) => port.withTransaction((databaseTx) => work({
      upsertClub: (value) => port.upsertCanonicalClub(databaseTx, value),
      upsertPlayer: (value) => port.upsertCanonicalPlayer(databaseTx, value),
      upsertMatch: (value) => port.upsertCanonicalMatch(databaseTx, value),
      upsertPlayerStat: (value) => port.upsertCanonicalPlayerStat(databaseTx, value),
      upsertLineupEntry: port.upsertCanonicalLineupEntry ? (value) => port.upsertCanonicalLineupEntry!(databaseTx, value) : undefined,
      upsertMatchEvent: port.upsertCanonicalMatchEvent ? (value) => port.upsertCanonicalMatchEvent!(databaseTx, value) : undefined,
      upsertObservation: (value) => port.upsertSourceObservation(databaseTx, value),
    })),
    recordSyncRun: (run) => port.insertSyncRun(run),
  };
}
