import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '202609150001_initial_schema.sql'),
  'utf8',
);

const TABLES = [
  'users', 'sessions', 'profiles', 'tournaments', 'clubs', 'players', 'tournament_players',
  'fantasy_teams', 'gameweeks', 'squad_players', 'lineups', 'lineup_players', 'leagues',
  'league_memberships', 'transfers', 'transfer_items', 'club_external_ids', 'player_external_ids',
  'matches', 'match_external_ids', 'player_match_stats', 'source_observations', 'sync_runs',
  'player_club_history', 'tournament_roster_registrations', 'onboarding_drafts',
  'team_reward_state', 'team_chips', 'reward_milestone_claims', 'quest_progress', 'chest_claims',
  'player_fantasy_points', 'team_gameweek_scores', 'pricing_runs', 'player_price_history',
] as const;

describe('Supabase initial schema', () => {
  it('defines exactly the 35 canonical SQLite tables', () => {
    const created = [...schema.matchAll(/^create table ([a-z_]+) \(/gmi)].map(match => match[1]).sort();
    expect(created).toEqual([...TABLES].sort());
  });

  it('uses PostgreSQL-safe money, identity, JSON and boolean types', () => {
    expect(schema).toContain('budget_cents bigint');
    expect(schema).toContain('email citext');
    expect(schema).toContain('value_json jsonb');
    expect(schema).toContain('wildcard_used boolean');
    expect(schema).not.toMatch(/\bcollate nocase\b/i);
  });

  it('preserves the price initializer and denies browser roles direct table access', () => {
    expect(schema).toContain('create trigger tournament_players_initialize_price');
    expect(schema).toContain('enable row level security');
    expect(schema).toContain('revoke all on table %I from anon, authenticated');
  });
});
