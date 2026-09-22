import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from './worker.js';

afterEach(() => vi.unstubAllEnvs());

function response() {
  let status = 0;
  let body: unknown;
  const api = {
    setHeader: () => {},
    status: (code: number) => { status = code; return api; },
    json: (value: unknown) => { body = value; },
  };
  return { api, result: () => ({ status, body }) };
}

describe('worker productivo cerrado por defecto', () => {
  it('rechaza una llamada sin el secreto interno', async () => {
    vi.stubEnv('PIPELINE_WORKER_SECRET', 'qa-worker-secret');
    vi.stubEnv('SUPABASE_PRODUCTIVE_WORKER_ENABLED', 'false');
    const reply = response();
    await handler({ method: 'POST', headers: {} }, reply.api);
    expect(reply.result().status).toBe(401);
  });

  it('responde 503 al autenticado mientras el flag está apagado', async () => {
    vi.stubEnv('PIPELINE_WORKER_SECRET', 'qa-worker-secret');
    vi.stubEnv('SUPABASE_PRODUCTIVE_WORKER_ENABLED', 'false');
    const reply = response();
    await handler({ method: 'POST', headers: { authorization: 'Bearer qa-worker-secret' } }, reply.api);
    expect(reply.result()).toEqual({ status: 503,
      body: { error: { code: 'PRODUCTIVE_WORKER_DISABLED' } } });
  });
});
