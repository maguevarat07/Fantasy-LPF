import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from './sync.js';

afterEach(() => vi.unstubAllEnvs());

describe('cron de sincronización', () => {
  it('rechaza solicitudes que no fueron firmadas por Vercel', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-test-secret');
    let statusCode = 0;
    let body: unknown;
    const response = {
      setHeader: vi.fn(),
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(value: unknown) {
        body = value;
      },
    };

    await handler({ headers: {} }, response);

    expect(statusCode).toBe(401);
    expect(body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Solicitud de cron no autorizada.' },
    });
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
