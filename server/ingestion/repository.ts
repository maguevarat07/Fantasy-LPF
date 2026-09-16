import type { NormalizedClub, NormalizedLineupEntry, NormalizedMatch, NormalizedMatchEvent, NormalizedPlayer, NormalizedPlayerStat, PersistenceResult, SourceObservation, SyncRunRecord } from './types.js';

/**
 * Backend contract required by ingestion. Each upsert must use the external
 * identity `(source, externalId)` and must also upsert the PlayerExternalId /
 * MatchExternalId / ClubExternalId link. Observation uniqueness should be
 * `(source, entityType, externalEntityId, parserVersion, contentHash)`.
 */
export interface CanonicalDataTransaction {
  upsertClub(value: NormalizedClub): Promise<'created' | 'updated' | 'unchanged'>;
  upsertPlayer(value: NormalizedPlayer): Promise<'created' | 'updated' | 'unchanged'>;
  upsertMatch(value: NormalizedMatch): Promise<'created' | 'updated' | 'unchanged'>;
  upsertPlayerStat(value: NormalizedPlayerStat): Promise<'created' | 'updated' | 'unchanged'>;
  upsertLineupEntry?(value: NormalizedLineupEntry): Promise<'created' | 'updated' | 'unchanged'>;
  upsertMatchEvent?(value: NormalizedMatchEvent): Promise<'created' | 'updated' | 'unchanged'>;
  upsertObservation(value: SourceObservation): Promise<'created' | 'unchanged'>;
}

export interface CanonicalDataRepository {
  transaction<T>(work: (tx: CanonicalDataTransaction) => Promise<T>): Promise<T>;
  recordSyncRun(run: SyncRunRecord): Promise<void>;
}

export async function persistEntities(
  repository: CanonicalDataRepository,
  entities: Array<NormalizedClub | NormalizedPlayer | NormalizedMatch | NormalizedPlayerStat | NormalizedLineupEntry | NormalizedMatchEvent>,
  observations: SourceObservation[],
): Promise<PersistenceResult> {
  return repository.transaction(async (tx) => {
    let created = 0;
    let updated = 0;
    for (const entity of entities) {
      const result = entity.kind === 'club' ? await tx.upsertClub(entity)
        : entity.kind === 'player' ? await tx.upsertPlayer(entity)
        : entity.kind === 'match' ? await tx.upsertMatch(entity)
        : entity.kind === 'player_stat' ? await tx.upsertPlayerStat(entity)
        : entity.kind === 'lineup' ? await requireWriter(tx.upsertLineupEntry, entity.kind)(entity)
        : await requireWriter(tx.upsertMatchEvent, entity.kind)(entity);
      if (result === 'created') created += 1;
      if (result === 'updated') updated += 1;
    }
    for (const observation of observations) await tx.upsertObservation(observation);
    return { created, updated };
  });
}

function requireWriter<T>(writer: ((value: T) => Promise<'created' | 'updated' | 'unchanged'>) | undefined, kind: string) {
  if (!writer) throw new Error(`El repositorio no implementa persistencia para ${kind}.`);
  return writer;
}
