import {
  ScheduledSyncUnavailableError,
  runScheduledDataSync,
} from '../../server/ingestion/scheduledSync.js';

interface VercelRequest {
  headers: Record<string, string | string[] | undefined>;
}

interface VercelResponse {
  setHeader(name: string, value: string): void;
  status(code: number): VercelResponse;
  json(body: unknown): void;
}

function json(response: VercelResponse, body: unknown, status: number): void {
  response.setHeader('Cache-Control', 'no-store');
  response.status(status).json(body);
}

/** Daily production sync invoked by Vercel Cron. */
export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.authorization;

  // Fail closed when the deployment was not configured with a secret. Vercel sends this
  // header automatically for scheduled requests when CRON_SECRET exists in the project.
  if (!secret || authorization !== `Bearer ${secret}`) {
    json(response, { error: { code: 'UNAUTHORIZED', message: 'Solicitud de cron no autorizada.' } }, 401);
    return;
  }

  try {
    const result = await runScheduledDataSync();
    json(response, { success: true, result }, 200);
  } catch (error) {
    if (error instanceof ScheduledSyncUnavailableError) {
      json(response, { error: { code: 'SYNC_UNAVAILABLE', message: error.message } }, 503);
      return;
    }
    console.error('Falló la sincronización programada:', error);
    json(response, { error: { code: 'SYNC_FAILED', message: 'La sincronización programada falló.' } }, 500);
  }
}
