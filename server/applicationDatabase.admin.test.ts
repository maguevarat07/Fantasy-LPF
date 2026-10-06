import { describe, expect, it } from 'vitest';
import { applicationDatabase } from './applicationDatabase.js';
import type { PostgresDatabase, PostgresExecutor, QueryRow } from './postgres/client.js';

function fakeDatabase(login: string, bypass = false) {
  const commands: string[] = [];
  const executor: PostgresExecutor = {
    query: async () => [],
    one: async <T extends QueryRow = QueryRow>(): Promise<T> => ({ login, bypass, superuser: false }) as unknown as T,
    maybeOne: async <T extends QueryRow = QueryRow>(sql: string): Promise<T | undefined> => {
      commands.push(sql);
      return { allowed: true } as unknown as T;
    },
    execute: async (sql) => { commands.push(sql); return 0; },
  };
  const database: PostgresDatabase = {
    ...executor,
    transaction: async work => work(executor),
    close: async () => undefined,
  };
  return { database, commands };
}

describe('administrative database login isolation', () => {
  it('refuses the table-owning production login before assuming admin_reader', async () => {
    const { database, commands } = fakeDatabase('postgres', true);
    const admin = applicationDatabase(database, { enforceRls: true, role: 'fantasy_lpf_admin_reader' });
    await expect(admin.prepare('SELECT 1').get()).rejects.toThrow('not isolated');
    expect(commands).not.toContain('SET LOCAL ROLE fantasy_lpf_admin_reader');
  });

  it('assumes admin_reader only from the dedicated non-BYPASSRLS login', async () => {
    const { database, commands } = fakeDatabase('fantasy_lpf_admin_api');
    const admin = applicationDatabase(database, { enforceRls: true, role: 'fantasy_lpf_admin_reader' });
    await admin.prepare('SELECT 1').get();
    expect(commands).toContain('SET LOCAL ROLE fantasy_lpf_admin_reader');
  });

  it('refuses a misconfigured admin login with BYPASSRLS', async () => {
    const { database } = fakeDatabase('fantasy_lpf_admin_api', true);
    const admin = applicationDatabase(database, { enforceRls: true, role: 'fantasy_lpf_admin_reader' });
    await expect(admin.prepare('SELECT 1').get()).rejects.toThrow('not isolated');
  });
});
