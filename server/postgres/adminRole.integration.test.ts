import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresDatabase, type PostgresDatabase } from './client.js';

const testUrl = process.env.POSTGRES_TEST_URL;
const schema = `qa_admin_${randomUUID().replaceAll('-', '')}`;
let owner: Sql;
let db: PostgresDatabase;

describe.skipIf(!testUrl)('PostgreSQL administrative role boundary', () => {
  beforeAll(async () => {
    owner = postgres(testUrl!, { max: 1, prepare: false });
    await owner.unsafe(`create schema "${schema}"`);
    db = createPostgresDatabase({ url: testUrl!, maxConnections: 1 });
    await db.execute(`set search_path to "${schema}", public`);
    const current = await db.one<{ name: string }>('select current_schema() as name');
    if (current.name !== schema) throw new Error('QA schema isolation failed.');
    for (const file of ['202609150001_initial_schema.sql','202609190001_rls_isolation.sql',
      '202609190002_durable_pipeline.sql','202610060001_admin_read_only.sql']) {
      const sql = await readFile(`supabase/migrations/${file}`, 'utf8');
      await db.execute(sql.replaceAll('public.', `"${schema}".`));
    }
    await db.execute(`grant usage on schema "${schema}" to fantasy_lpf_app, fantasy_lpf_admin_reader`);
  }, 120_000);
  afterAll(async () => {
    await db?.close();
    if (owner) { await owner.unsafe(`drop schema if exists "${schema}" cascade`); await owner.end({timeout:5}); }
  }, 30_000);

  it('denies direct and inherited SET ROLE from normal application and Supabase browser roles', async () => {
    for (const role of ['fantasy_lpf_app','anon','authenticated']) {
      const membership = await db.one<{ allowed: boolean }>(
        'select pg_has_role($1::text,$2::text,\'MEMBER\') as allowed', [role,'fantasy_lpf_admin_reader']);
      expect(membership.allowed).toBe(false);
      await expect(db.transaction(async tx => {
        // SET ROLE checks the session authorization identity. Simply SET ROLE
        // from postgres would retain postgres membership and give a false result.
        await tx.execute(`set session authorization ${role}`);
        await tx.execute('set role fantasy_lpf_admin_reader');
      })).rejects.toThrow();
    }
  });
});
