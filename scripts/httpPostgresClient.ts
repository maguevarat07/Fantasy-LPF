import type {
  PostgresDatabase,
  QueryRow,
  SqlParameter,
} from '../server/postgres/client.js';

interface HttpResponse {
  rows?: QueryRow[];
  count?: number;
  counts?: number[];
  error?: { message?: string };
}

function migrationConfig() {
  const url = process.env.MIGRATION_HTTP_URL;
  const secret = process.env.MIGRATION_SECRET ?? process.env.CRON_SECRET;
  if (!url || !secret) throw new Error('MIGRATION_HTTP_URL y MIGRATION_SECRET son obligatorios.');
  return { url: url.replace(/\/$/, ''), secret };
}

async function request(body: Record<string, unknown>): Promise<HttpResponse> {
  const { url, secret } = migrationConfig();
  const response = await fetch(`${url}/api/admin/migrate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as HttpResponse;
  if (!response.ok) throw new Error(payload.error?.message ?? `Migración HTTP falló (${response.status}).`);
  return payload;
}

export async function runHttpTransaction(
  statements: Array<{ text: string; parameters?: readonly SqlParameter[] }>,
): Promise<number[]> {
  const response = await request({ mode: 'transaction', statements });
  return response.counts ?? [];
}

export function createHttpPostgresDatabase(): PostgresDatabase {
  const database: PostgresDatabase = {
    async query<T extends QueryRow = QueryRow>(text: string, parameters: readonly SqlParameter[] = []) {
      const response = await request({ mode: 'query', text, parameters });
      return (response.rows ?? []) as T[];
    },
    async one<T extends QueryRow = QueryRow>(text: string, parameters: readonly SqlParameter[] = []) {
      const rows = await database.query<T>(text, parameters);
      if (rows.length !== 1) throw new Error(`Se esperaba exactamente una fila y se recibieron ${rows.length}.`);
      return rows[0];
    },
    async maybeOne<T extends QueryRow = QueryRow>(
      text: string,
      parameters: readonly SqlParameter[] = [],
    ): Promise<T | undefined> {
      const rows = await database.query<T>(text, parameters);
      if (rows.length > 1) throw new Error(`Se esperaba como máximo una fila y se recibieron ${rows.length}.`);
      return rows[0] as T | undefined;
    },
    async execute(text: string, parameters: readonly SqlParameter[] = []) {
      const response = await request({ mode: 'execute', text, parameters });
      return response.count ?? 0;
    },
    // Import batches are idempotent (ON CONFLICT DO NOTHING). Each HTTP request is
    // atomic in PostgreSQL; the remote transport cannot hold a connection open.
    transaction: work => work(database),
    async close() {},
  };
  return database;
}
