import {
  ScheduledSyncUnavailableError,
  runScheduledDataSync,
} from '../../server/ingestion/scheduledSync.js';

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** Daily production sync invoked by Vercel Cron. */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');

  // Fail closed when the deployment was not configured with a secret. Vercel sends this
  // header automatically for scheduled requests when CRON_SECRET exists in the project.
  if (!secret || authorization !== `Bearer ${secret}`) {
    return json({ error: { code: 'UNAUTHORIZED', message: 'Solicitud de cron no autorizada.' } }, 401);
  }

  try {
    const result = await runScheduledDataSync();
    return json({ success: true, result }, 200);
  } catch (error) {
    if (error instanceof ScheduledSyncUnavailableError) {
      return json({ error: { code: 'SYNC_UNAVAILABLE', message: error.message } }, 503);
    }
    console.error('Falló la sincronización programada:', error);
    return json({ error: { code: 'SYNC_FAILED', message: 'La sincronización programada falló.' } }, 500);
  }
}
