import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/202610060001_admin_read_only.sql','utf8');

describe('administrative migration contract', () => {
  it('creates a non-login reader without bypass RLS and rejects normal memberships', () => {
    expect(migration).toContain('create role fantasy_lpf_admin_reader nologin noinherit nobypassrls');
    for (const role of ['fantasy_lpf_app','anon','authenticated']) {
      expect(migration).toContain(`pg_has_role('${role}', 'fantasy_lpf_admin_reader', 'MEMBER')`);
    }
    expect(migration).not.toContain('grant fantasy_lpf_admin_reader to fantasy_lpf_app');
  });
  it('does not grant password, MFA or token data to the reader', () => {
    expect(migration).toContain('grant select(id,email,username,created_at) on users');
    expect(migration).toContain('grant select(user_id,last_seen_at) on sessions');
    expect(migration).toContain('revoke all on public.%I from public, anon, authenticated, fantasy_lpf_app, fantasy_lpf_admin_reader');
  });
});
