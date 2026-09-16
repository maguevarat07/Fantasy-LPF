import postgres, { type Sql } from 'postgres';

export type SqlParameter = string | number | boolean | Date | Uint8Array | null;
export type QueryRow = Record<string, unknown>;

export interface PostgresExecutor {
  query<T extends QueryRow = QueryRow>(text: string, parameters?: readonly SqlParameter[]): Promise<T[]>;
  one<T extends QueryRow = QueryRow>(text: string, parameters?: readonly SqlParameter[]): Promise<T>;
  maybeOne<T extends QueryRow = QueryRow>(text: string, parameters?: readonly SqlParameter[]): Promise<T | undefined>;
  execute(text: string, parameters?: readonly SqlParameter[]): Promise<number>;
}

export type PostgresTransaction = PostgresExecutor;

export interface PostgresDatabase extends PostgresExecutor {
  transaction<T>(work: (transaction: PostgresTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface CreatePostgresDatabaseOptions {
  url?: string;
  maxConnections?: number;
  idleTimeoutSeconds?: number;
  connectTimeoutSeconds?: number;
}

function parameterList(parameters: readonly SqlParameter[]): SqlParameter[] {
  return [...parameters];
}

function executor(sql: Pick<Sql, 'unsafe'>): PostgresExecutor {
  const query = async <T extends QueryRow = QueryRow>(
    text: string,
    parameters: readonly SqlParameter[] = [],
  ): Promise<T[]> => {
    const rows = await sql.unsafe<T[]>(text, parameterList(parameters));
    return [...rows];
  };

  return {
    query,
    async one<T extends QueryRow = QueryRow>(text: string, parameters: readonly SqlParameter[] = []) {
      const rows = await query<T>(text, parameters);
      if (rows.length !== 1) throw new Error(`Se esperaba exactamente una fila y se recibieron ${rows.length}.`);
      return rows[0];
    },
    async maybeOne<T extends QueryRow = QueryRow>(
      text: string,
      parameters: readonly SqlParameter[] = [],
    ): Promise<T | undefined> {
      const rows = await query<T>(text, parameters);
      if (rows.length > 1) throw new Error(`Se esperaba como máximo una fila y se recibieron ${rows.length}.`);
      return rows[0];
    },
    async execute(text: string, parameters: readonly SqlParameter[] = []) {
      const result = await sql.unsafe(text, parameterList(parameters));
      return result.count;
    },
  };
}

export function createPostgresDatabase(options: CreatePostgresDatabaseOptions = {}): PostgresDatabase {
  const url = options.url ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL o POSTGRES_URL es obligatorio para conectar PostgreSQL.');

  // Supavisor's transaction pooler does not support session-bound prepared
  // statements. Keeping one connection per function instance also prevents a
  // serverless deployment from exhausting the database connection limit.
  const sql = postgres(url, {
    max: options.maxConnections ?? 1,
    prepare: false,
    idle_timeout: options.idleTimeoutSeconds ?? 20,
    connect_timeout: options.connectTimeoutSeconds ?? 15,
    transform: { undefined: null },
    connection: { application_name: 'fantasy-lpf' },
  });
  const base = executor(sql);

  return {
    ...base,
    transaction: async <T>(work: (transaction: PostgresTransaction) => Promise<T>): Promise<T> => {
      const result = await sql.begin(async transactionSql => work(executor(transactionSql)));
      return result as T;
    },
    close: () => sql.end({ timeout: 5 }),
  };
}

let sharedDatabase: PostgresDatabase | undefined;

export function getPostgresDatabase(): PostgresDatabase {
  sharedDatabase ??= createPostgresDatabase();
  return sharedDatabase;
}

export async function closePostgresDatabase(): Promise<void> {
  const database = sharedDatabase;
  sharedDatabase = undefined;
  await database?.close();
}
