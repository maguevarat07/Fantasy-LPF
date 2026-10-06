import { afterEach, describe, expect, it, vi } from 'vitest';
import { isolatedPostgresTestUrl } from './testIsolation.js';

afterEach(() => vi.unstubAllEnvs());

describe('PostgreSQL fixture isolation guard', () => {
  it('requires an explicit isolated-test opt-in', () => {
    vi.stubEnv('POSTGRES_TEST_URL', 'postgres://qa:pass@localhost:5432/qa');
    vi.stubEnv('POSTGRES_TEST_ISOLATED', 'false');
    expect(() => isolatedPostgresTestUrl()).toThrow('POSTGRES_TEST_ISOLATED');
  });

  it('rejects the same Supabase project across pooler ports', () => {
    vi.stubEnv('POSTGRES_TEST_ISOLATED', 'true');
    vi.stubEnv('POSTGRES_TEST_URL', 'postgres://postgres.qa-ref:pass@pooler.supabase.com:6543/postgres');
    vi.stubEnv('DATABASE_URL', 'postgres://postgres.qa-ref:other@pooler.supabase.com:5432/postgres');
    expect(() => isolatedPostgresTestUrl()).toThrow('production database');
  });

  it('accepts a distinct isolated database when explicitly enabled', () => {
    vi.stubEnv('POSTGRES_TEST_ISOLATED', 'true');
    vi.stubEnv('POSTGRES_TEST_URL', 'postgres://qa:pass@localhost:5432/qa');
    vi.stubEnv('DATABASE_URL', 'postgres://postgres:pass@production.example:5432/app');
    expect(isolatedPostgresTestUrl()).toContain('localhost');
  });
});
