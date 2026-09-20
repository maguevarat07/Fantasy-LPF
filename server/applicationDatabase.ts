import { AsyncLocalStorage } from 'node:async_hooks';
import type { SqliteDatabase } from './db.js';
import type { PostgresDatabase, PostgresExecutor, SqlParameter } from './postgres/client.js';

// Route serializers frequently carry database rows as Record<string, unknown>.
// Values are still validated by the concrete driver before being sent.
export type DatabaseParameter = unknown;
export interface DatabaseRunResult { changes: number }

export interface ApplicationStatement {
  get(...params: DatabaseParameter[]): Promise<Record<string, unknown> | undefined>;
  all(...params: DatabaseParameter[]): Promise<Array<Record<string, unknown>>>;
  run(...params: DatabaseParameter[]): Promise<DatabaseRunResult>;
}

export interface ApplicationDatabase {
  prepare(sql: string): ApplicationStatement;
  transaction<T>(work: () => T | Promise<T>): () => Promise<T>;
  withUser<T>(userId: string, work: () => T): T;
}

function postgresSql(sql: string): string {
  let output = '';
  let parameter = 0;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      output += character;
      if (character === quote) {
        if (sql[index + 1] === quote) output += sql[++index];
        else quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      output += character;
    } else if (character === '?') {
      output += `$${++parameter}`;
    } else {
      output += character;
    }
  }
  return output
    .replace(/\s+COLLATE\s+NOCASE\b/gi, '')
    .replace(/\bAS\s+([a-z][a-z0-9_]*[A-Z][A-Za-z0-9_]*)\b/g, 'AS "$1"')
    .replace('/* FOR_UPDATE */', 'FOR UPDATE');
}

class PostgresApplicationDatabase implements ApplicationDatabase {
  private readonly context = new AsyncLocalStorage<PostgresExecutor>();
  private readonly userContext = new AsyncLocalStorage<string>();

  constructor(private readonly database: PostgresDatabase, private readonly enforceRls: boolean) {}

  withUser<T>(userId: string, work: () => T): T {
    return this.userContext.run(userId, work);
  }

  private async scoped<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    const active = this.context.getStore();
    if (active) return work(active);
    if (!this.enforceRls) return work(this.database);
    return this.database.transaction(async tx => {
      await tx.execute('SET LOCAL ROLE fantasy_lpf_app');
      await tx.execute("SELECT set_config('app.user_id', $1, true)", [this.userContext.getStore() ?? '']);
      return work(tx);
    });
  }

  prepare(sql: string): ApplicationStatement {
    const text = postgresSql(sql);
    return {
      get: async (...params) => this.scoped(executor => executor.maybeOne(text, params as SqlParameter[])),
      all: async (...params) => this.scoped(executor => executor.query(text, params as SqlParameter[])),
      run: async (...params) => ({ changes: await this.scoped(executor => executor.execute(text, params as SqlParameter[])) }),
    };
  }

  transaction<T>(work: () => T | Promise<T>): () => Promise<T> {
    return () => this.database.transaction(async tx => {
      if (this.enforceRls) {
        await tx.execute('SET LOCAL ROLE fantasy_lpf_app');
        await tx.execute("SELECT set_config('app.user_id', $1, true)", [this.userContext.getStore() ?? '']);
      }
      return this.context.run(tx, async () => work());
    });
  }
}

class SqliteApplicationDatabase implements ApplicationDatabase {
  constructor(private readonly database: SqliteDatabase) {}

  withUser<T>(_userId: string, work: () => T): T { return work(); }

  prepare(sql: string): ApplicationStatement {
    const statement = this.database.prepare(sql);
    const sqliteParams = (params: DatabaseParameter[]) => params.map(value => (
      typeof value === 'boolean' ? Number(value) : value
    ));
    return {
      get: async (...params) => statement.get(...sqliteParams(params)) as Record<string, unknown> | undefined,
      all: async (...params) => statement.all(...sqliteParams(params)) as Array<Record<string, unknown>>,
      run: async (...params) => {
        const result = statement.run(...sqliteParams(params));
        return { changes: result.changes };
      },
    };
  }

  transaction<T>(work: () => T | Promise<T>): () => Promise<T> {
    return async () => {
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const result = await work();
        this.database.exec('COMMIT');
        return result;
      } catch (error) {
        if (this.database.inTransaction) this.database.exec('ROLLBACK');
        throw error;
      }
    };
  }
}

export function applicationDatabase(database: SqliteDatabase | PostgresDatabase, options: { enforceRls?: boolean } = {}): ApplicationDatabase {
  if ('prepare' in database) return new SqliteApplicationDatabase(database);
  return new PostgresApplicationDatabase(database, options.enforceRls ?? false);
}
