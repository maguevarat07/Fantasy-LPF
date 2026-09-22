import type { PostgresDatabase } from '../postgres/client.js';
import { nextPipelineStage, runScheduledDataSync, type ScheduledSyncDependencies } from './scheduledSync.js';

export type QueueStage = 'INGEST' | 'PUBLISH' | 'SCORE' | 'PRICE';
export interface PipelineQueueMessage {
  runId: string;
  tournamentId: string;
  gameweekId: string | null;
  stage: QueueStage;
  cursor: { entity: number; observation: number };
  attempt: number;
  createdAt: string;
}

interface QueueRecord extends Record<string, unknown> {
  msg_id: string;
  read_ct: string;
  message: PipelineQueueMessage;
}

export interface QueueWorkerResult {
  messageId: string | null;
  runId: string | null;
  stage: string | null;
  archived: boolean;
  nextStage: QueueStage | null;
}

function queueName(value: string): string {
  if (!/^fantasy_pipeline(?:_qa_[a-z0-9]+)?$/.test(value)) throw new Error('Nombre de cola no autorizado.');
  return value;
}

function queueMessage(value: unknown): PipelineQueueMessage {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) as unknown; }
    catch { throw new Error('Mensaje JSON de pipeline inválido.'); }
  }
  if (!value || typeof value !== 'object') throw new Error('Mensaje de pipeline inválido.');
  const message = value as Partial<PipelineQueueMessage>;
  if (typeof message.runId !== 'string' || !message.runId
    || typeof message.tournamentId !== 'string' || !message.tournamentId
    || !['INGEST', 'PUBLISH', 'SCORE', 'PRICE'].includes(message.stage ?? '')
    || typeof message.attempt !== 'number' || !Number.isSafeInteger(message.attempt)
    || message.attempt < 0) throw new Error('Contrato de mensaje de pipeline inválido.');
  return message as PipelineQueueMessage;
}

async function enqueueNext(db: PostgresDatabase, name: string, messageId: string,
  previous: PipelineQueueMessage, stage: QueueStage | null, attempt: number,
  delaySeconds = 0): Promise<void> {
  await db.transaction(async tx => {
    if (stage) {
      const cursor = await tx.maybeOne<{ entity_cursor: number; observation_cursor: number }>(
        'select entity_cursor,observation_cursor from pipeline_ingest_payloads where run_id=$1', [previous.runId]);
      const next: PipelineQueueMessage = { ...previous, stage,
        cursor: { entity: cursor?.entity_cursor ?? 0, observation: cursor?.observation_cursor ?? 0 },
        attempt, createdAt: new Date().toISOString() };
      await tx.query('select pgmq.send($1::text,$2::jsonb,$3::integer) as msg_id', [name, JSON.stringify(next), delaySeconds]);
    }
    const archived = await tx.one<{ archived: boolean }>(
      'select pgmq.archive($1,$2::bigint) as archived', [name, messageId]);
    if (!archived.archived) throw new Error('No se pudo archivar el mensaje procesado.');
  });
}

/** Processes exactly one durable message; the existing pipeline remains authoritative. */
export async function consumePipelineQueueMessage(
  db: PostgresDatabase,
  name = 'fantasy_pipeline',
  dependencies: Omit<ScheduledSyncDependencies, 'db'> = {},
): Promise<QueueWorkerResult> {
  const safeName = queueName(name);
  // Longer than the eight-minute pipeline lease, so a crashed worker can be
  // redelivered after that lease expires. Vercel requests are capped at 300s.
  const rows = await db.query<QueueRecord>('select * from pgmq.read($1,540,1)', [safeName]);
  const record = rows[0];
  if (!record) return { messageId: null, runId: null, stage: null, archived: false, nextStage: null };
  const message = queueMessage(record.message);
  const run = await db.maybeOne<{ stage: Parameters<typeof nextPipelineStage>[0]; next_retry_at: string | null }>(
    'select stage,next_retry_at from pipeline_runs where id=$1', [message.runId]);
  if (!run) throw new Error(`No existe el run ${message.runId} del mensaje ${record.msg_id}.`);
  const pending = nextPipelineStage(run.stage);
  if (pending !== message.stage) {
    await enqueueNext(db, safeName, record.msg_id, message, pending, message.attempt);
    return { messageId: record.msg_id, runId: message.runId, stage: run.stage,
      archived: true, nextStage: pending };
  }
  if (Number(record.read_ct) > 5) {
    await db.transaction(async tx => {
      await tx.execute(`update pipeline_runs set stage='FAILED',quality_status='FAILED',
        last_error='El mensaje de cola excedió cinco entregas sin completar la etapa.',
        finished_at=now(),updated_at=now() where id=$1
        and stage not in ('PRICED','PARTIAL','FAILED')`, [message.runId]);
      const archived = await tx.one<{ archived: boolean }>(
        'select pgmq.archive($1,$2::bigint) as archived', [safeName, record.msg_id]);
      if (!archived.archived) throw new Error('No se pudo archivar el mensaje agotado.');
    });
    return { messageId: record.msg_id, runId: message.runId, stage: 'FAILED',
      archived: true, nextStage: null };
  }
  if (run.next_retry_at && Date.parse(run.next_retry_at) > Date.now()) {
    const delay = Math.ceil((Date.parse(run.next_retry_at) - Date.now()) / 1000);
    await enqueueNext(db, safeName, record.msg_id, message, pending, message.attempt + 1, delay);
    return { messageId: record.msg_id, runId: message.runId, stage: run.stage,
      archived: true, nextStage: pending };
  }
  const result = await runScheduledDataSync({ ...dependencies, db });
  if (result.runId === 'already-running') {
    return { messageId: record.msg_id, runId: message.runId, stage: result.stage,
      archived: false, nextStage: message.stage };
  }
  if (result.runId !== message.runId) throw new Error('El worker avanzó un run distinto al mensaje leído.');
  await enqueueNext(db, safeName, record.msg_id, message, result.nextStage, 0);
  return { messageId: record.msg_id, runId: result.runId, stage: result.stage,
    archived: true, nextStage: result.nextStage };
}
