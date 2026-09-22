import { consumePipelineQueueMessage } from '../../server/ingestion/queueWorker.js';
import { getPostgresDatabase } from '../../server/postgres/client.js';

interface Request {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}
interface Response {
  setHeader(name: string, value: string): void;
  status(code: number): Response;
  json(body: unknown): void;
}

/** A single bounded queue unit; Supabase Cron is the future dispatcher only. */
export default async function handler(request: Request, response: Response): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
    return;
  }
  const secret = process.env.PIPELINE_WORKER_SECRET;
  if (!secret || request.headers.authorization !== `Bearer ${secret}`) {
    response.status(401).json({ error: { code: 'UNAUTHORIZED' } });
    return;
  }
  // This handler is authoritative. It must never be used as the shadow worker.
  if (process.env.SUPABASE_PRODUCTIVE_WORKER_ENABLED !== 'true') {
    response.status(503).json({ error: { code: 'PRODUCTIVE_WORKER_DISABLED' } });
    return;
  }
  try {
    const result = await consumePipelineQueueMessage(getPostgresDatabase(), 'fantasy_pipeline', {
      publishEntityBatchSize: 50,
      publishObservationBatchSize: 100,
      scoreGameweekBatchSize: 3,
    });
    response.status(200).json({ success: true, result });
  } catch (error) {
    console.error('Falló un mensaje de la cola deportiva:', error);
    response.status(500).json({ error: { code: 'PIPELINE_QUEUE_FAILED' } });
  }
}
