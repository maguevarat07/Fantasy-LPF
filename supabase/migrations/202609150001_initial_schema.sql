-- Fantasy LPF canonical PostgreSQL schema.
-- Money is stored in integer cents; timestamps are absolute UTC instants.

create extension if not exists citext;

create table users (
  id text primary key,
  email citext not null unique,
  username citext not null unique,
  password_hash text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  last_seen_at timestamptz not null
);
create index sessions_user_id_idx on sessions(user_id);
create index sessions_expires_at_idx on sessions(expires_at);

create table profiles (
  user_id text primary key references users(id) on delete cascade,
  manager_name text not null,
  province text not null default '',
  favorite_club_id text,
  avatar_url text not null default '',
  notifications_enabled boolean not null default true,
  email_alerts_enabled boolean not null default true,
  updated_at timestamptz not null,
  phone text not null default ''
);

create table tournaments (
  id text primary key,
  name text not null,
  status text not null check (status in ('UPCOMING', 'ACTIVE', 'FINISHED')),
  budget_cents bigint not null default 10000000000 check (budget_cents >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null
);

create table clubs (
  id text primary key,
  name text not null,
  code text not null unique,
  active boolean not null default true,
  normalized_name text
);
create unique index clubs_normalized_name_idx on clubs(normalized_name) where normalized_name is not null;

alter table profiles add constraint profiles_favorite_club_fk
  foreign key (favorite_club_id) references clubs(id);

create table players (
  id text primary key,
  club_id text references clubs(id),
  name text not null,
  position text check (position in ('GK', 'DEF', 'MID', 'FWD')),
  price_cents bigint not null default 0 check (price_cents >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INJURED', 'SUSPENDED', 'INACTIVE')),
  active boolean not null default true,
  updated_at timestamptz not null,
  display_name text,
  normalized_name text,
  date_of_birth date,
  nationality text,
  shirt_number integer,
  image_url text
);
create index players_club_idx on players(club_id);
create index players_identity_idx on players(normalized_name, club_id);

create table tournament_players (
  tournament_id text not null references tournaments(id) on delete cascade,
  player_id text not null references players(id) on delete cascade,
  price_cents bigint not null check (price_cents >= 0),
  active boolean not null default true,
  previous_price_cents bigint,
  price_updated_at timestamptz,
  pricing_version text,
  initial_price_cents bigint not null default 0 check (initial_price_cents >= 0),
  fair_price_cents bigint check (fair_price_cents is null or fair_price_cents >= 0),
  last_change_cents bigint,
  last_calculated_gameweek_id text,
  pricing_status text not null default 'LEGACY' check (pricing_status in ('LEGACY', 'CURRENT', 'STALE', 'ERROR')),
  primary key (tournament_id, player_id)
);

create table fantasy_teams (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  tournament_id text not null references tournaments(id),
  name text not null,
  formation text not null,
  bank_cents bigint not null check (bank_cents >= 0),
  total_points integer not null default 0,
  gameweek_points integer not null default 0,
  free_transfers integer not null default 1 check (free_transfers >= 0),
  transfer_penalty_points integer not null default 0 check (transfer_penalty_points >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (user_id, tournament_id)
);
create index fantasy_teams_tournament_idx on fantasy_teams(tournament_id);

create table gameweeks (
  id text primary key,
  tournament_id text not null references tournaments(id) on delete cascade,
  week_number integer not null,
  name text not null,
  starts_at timestamptz,
  deadline_at timestamptz not null,
  ends_at timestamptz,
  status text not null check (status in ('OPEN', 'LOCKED', 'LIVE', 'FINISHED')),
  unique (tournament_id, week_number)
);
create index gameweeks_tournament_status_idx on gameweeks(tournament_id, status, week_number);

alter table tournament_players add constraint tournament_players_last_gameweek_fk
  foreign key (last_calculated_gameweek_id) references gameweeks(id);

create table squad_players (
  fantasy_team_id text not null references fantasy_teams(id) on delete cascade,
  player_id text not null references players(id),
  purchase_price_cents bigint not null check (purchase_price_cents >= 0),
  acquired_at timestamptz not null,
  purchase_gameweek_id text references gameweeks(id),
  primary key (fantasy_team_id, player_id)
);
create index squad_players_player_idx on squad_players(player_id);
create index squad_players_purchase_gameweek_idx on squad_players(purchase_gameweek_id, fantasy_team_id);

create table lineups (
  fantasy_team_id text not null references fantasy_teams(id) on delete cascade,
  gameweek_id text not null,
  formation text not null,
  captain_player_id text not null references players(id),
  vice_captain_player_id text not null references players(id),
  submitted_at timestamptz not null,
  primary key (fantasy_team_id, gameweek_id),
  check (captain_player_id <> vice_captain_player_id)
);

create table lineup_players (
  fantasy_team_id text not null,
  gameweek_id text not null,
  player_id text not null references players(id),
  role text not null check (role in ('STARTER', 'BENCH')),
  slot integer not null,
  primary key (fantasy_team_id, gameweek_id, player_id),
  unique (fantasy_team_id, gameweek_id, role, slot),
  foreign key (fantasy_team_id, gameweek_id) references lineups(fantasy_team_id, gameweek_id) on delete cascade
);

create table leagues (
  id text primary key,
  tournament_id text not null references tournaments(id),
  owner_user_id text not null references users(id),
  name text not null,
  code citext not null unique,
  created_at timestamptz not null
);
create index leagues_tournament_idx on leagues(tournament_id);

create table league_memberships (
  league_id text not null references leagues(id) on delete cascade,
  fantasy_team_id text not null references fantasy_teams(id) on delete cascade,
  joined_at timestamptz not null,
  primary key (league_id, fantasy_team_id)
);

create table transfers (
  id text primary key,
  fantasy_team_id text not null references fantasy_teams(id) on delete cascade,
  gameweek_id text not null,
  bank_before_cents bigint not null,
  bank_after_cents bigint not null,
  points_cost integer not null default 0,
  created_at timestamptz not null,
  status text not null default 'CONFIRMED' check (status in ('CONFIRMED', 'PENDING', 'FAILED', 'REVERTED')),
  operation_origin text not null default 'USER' check (operation_origin in ('USER', 'INITIAL_SQUAD', 'BENCH', 'SEED', 'TEST', 'ADMIN')),
  confirmed_at timestamptz,
  reverted_at timestamptz,
  wildcard_used boolean not null default false
);
create index transfers_team_idx on transfers(fantasy_team_id, created_at);
create index transfers_momentum_window_idx on transfers(status, operation_origin, confirmed_at, fantasy_team_id);

create table transfer_items (
  transfer_id text not null references transfers(id) on delete cascade,
  player_out_id text not null references players(id),
  player_in_id text not null references players(id),
  sell_price_cents bigint not null,
  buy_price_cents bigint not null,
  purchase_price_cents bigint check (purchase_price_cents is null or purchase_price_cents >= 0),
  profit_loss_cents bigint,
  purchase_gameweek_id text references gameweeks(id),
  primary key (transfer_id, player_out_id),
  unique (transfer_id, player_in_id)
);

create table club_external_ids (
  club_id text not null references clubs(id) on delete cascade,
  source text not null,
  external_id text not null,
  source_url text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (source, external_id),
  unique (club_id, source)
);

create table player_external_ids (
  player_id text not null references players(id) on delete cascade,
  source text not null,
  external_id text not null,
  source_url text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (source, external_id),
  unique (player_id, source)
);

create table matches (
  id text primary key,
  home_club_id text references clubs(id),
  away_club_id text references clubs(id),
  home_club_name text not null,
  away_club_name text not null,
  starts_at timestamptz,
  home_score integer,
  away_score integer,
  round text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  gameweek_id text references gameweeks(id),
  score_status text not null default 'PENDING' check (score_status in ('PENDING', 'PROVISIONAL', 'CONFIRMED', 'CORRECTED'))
);

create table match_external_ids (
  match_id text not null references matches(id) on delete cascade,
  source text not null,
  external_id text not null,
  source_url text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (source, external_id),
  unique (match_id, source)
);

create table player_match_stats (
  player_id text not null references players(id) on delete cascade,
  match_id text not null references matches(id) on delete cascade,
  source text not null,
  starter boolean,
  substitute_in boolean,
  minutes integer,
  goals integer,
  assists integer,
  yellow_cards integer,
  red_cards integer,
  own_goals integer,
  saves integer,
  source_url text not null,
  external_id text not null,
  updated_at timestamptz not null,
  club_id text references clubs(id),
  assist_status text not null default 'PENDING' check (assist_status in ('PENDING', 'PROVISIONAL', 'CONFIRMED', 'CORRECTED')),
  primary key (player_id, match_id),
  unique (source, external_id)
);

create table source_observations (
  id text primary key,
  source text not null,
  entity_type text not null,
  external_entity_id text not null,
  source_url text not null,
  parser_version text not null,
  observed_at timestamptz not null,
  content_hash text not null,
  value_json jsonb not null,
  unique (source, entity_type, external_entity_id, parser_version, content_hash)
);

create table sync_runs (
  run_id text primary key,
  source text not null,
  job text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  status text not null,
  records_found integer not null,
  records_created integer not null,
  records_updated integer not null,
  conflicts integer not null,
  errors_json jsonb not null
);

create table player_club_history (
  id text primary key,
  player_id text not null references players(id) on delete cascade,
  from_club_id text references clubs(id),
  to_club_id text references clubs(id),
  source text not null,
  source_url text not null,
  detected_at timestamptz not null,
  ended_at timestamptz
);
create unique index player_club_history_open_idx on player_club_history(player_id, source) where ended_at is null;

create table tournament_roster_registrations (
  tournament_id text not null references tournaments(id) on delete cascade,
  player_id text not null references players(id) on delete cascade,
  source text not null,
  club_id text not null references clubs(id),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  ended_at timestamptz,
  active boolean not null default true,
  primary key (tournament_id, player_id, source)
);
create index tournament_roster_active_idx on tournament_roster_registrations(tournament_id, source, active);

create table onboarding_drafts (
  user_id text not null references users(id) on delete cascade,
  tournament_id text not null references tournaments(id) on delete cascade,
  step integer not null check (step between 1 and 6),
  team_name text,
  province text,
  favorite_club_id text,
  formation text,
  selected_player_ids_json jsonb not null default '[]'::jsonb,
  starters_json jsonb not null default '[]'::jsonb,
  bench_json jsonb not null default '[]'::jsonb,
  captain_player_id text,
  vice_captain_player_id text,
  updated_at timestamptz not null,
  primary key (user_id, tournament_id)
);

create table team_reward_state (
  fantasy_team_id text primary key references fantasy_teams(id) on delete cascade,
  mastery_xp integer not null default 0 check (mastery_xp >= 0),
  tactical_coins integer not null default 0 check (tactical_coins >= 0),
  updated_at timestamptz not null
);

create table team_chips (
  fantasy_team_id text not null references fantasy_teams(id) on delete cascade,
  chip_id text not null check (chip_id in ('wildcard', 'triple_cap', 'bench_boost', 'emergency_fund')),
  unlocked_at timestamptz,
  active_gameweek_id text references gameweeks(id),
  used_gameweek_id text references gameweeks(id),
  activated_at timestamptz,
  primary key (fantasy_team_id, chip_id)
);
create unique index one_active_chip_per_gameweek_idx on team_chips(fantasy_team_id, active_gameweek_id) where active_gameweek_id is not null;

create table reward_milestone_claims (
  fantasy_team_id text not null references fantasy_teams(id) on delete cascade,
  milestone_id text not null,
  claimed_at timestamptz not null,
  primary key (fantasy_team_id, milestone_id)
);

create table quest_progress (
  fantasy_team_id text not null references fantasy_teams(id) on delete cascade,
  gameweek_id text not null references gameweeks(id) on delete cascade,
  quest_id text not null,
  completed_at timestamptz,
  claimed_at timestamptz,
  xp_awarded integer not null default 0 check (xp_awarded >= 0),
  primary key (fantasy_team_id, gameweek_id, quest_id)
);

create table chest_claims (
  fantasy_team_id text not null references fantasy_teams(id) on delete cascade,
  gameweek_id text not null references gameweeks(id) on delete cascade,
  xp_awarded integer not null check (xp_awarded >= 0),
  budget_awarded_cents bigint not null check (budget_awarded_cents >= 0),
  claimed_at timestamptz not null,
  primary key (fantasy_team_id, gameweek_id)
);

create table player_fantasy_points (
  player_id text not null references players(id) on delete cascade,
  match_id text not null references matches(id) on delete cascade,
  gameweek_id text not null references gameweeks(id) on delete cascade,
  participation_points integer not null,
  goal_points integer not null,
  assist_points integer not null,
  clean_sheet_points integer not null,
  yellow_card_points integer not null,
  red_card_points integer not null,
  own_goal_points integer not null,
  total_points integer not null,
  input_hash text not null,
  calculation_version text not null,
  calculated_at timestamptz not null,
  primary key (player_id, match_id)
);
create index player_fantasy_points_gameweek_idx on player_fantasy_points(gameweek_id, player_id);

create table team_gameweek_scores (
  fantasy_team_id text not null references fantasy_teams(id) on delete cascade,
  gameweek_id text not null references gameweeks(id) on delete cascade,
  player_points integer not null,
  captain_bonus integer not null,
  transfer_penalty integer not null,
  total_points integer not null,
  input_hash text not null,
  calculation_version text not null,
  calculated_at timestamptz not null,
  primary key (fantasy_team_id, gameweek_id)
);

create table pricing_runs (
  id text primary key,
  tournament_id text not null references tournaments(id) on delete cascade,
  as_of_gameweek_id text not null references gameweeks(id) on delete cascade,
  formula_version text not null,
  config_json jsonb not null,
  input_hash text not null,
  status text not null check (status in ('RUNNING', 'COMPLETED', 'FAILED')),
  created_at timestamptz not null,
  completed_at timestamptz,
  unique (tournament_id, as_of_gameweek_id, formula_version, input_hash)
);
create index pricing_runs_lookup_idx on pricing_runs(tournament_id, as_of_gameweek_id, formula_version, created_at desc);
create index pricing_runs_status_idx on pricing_runs(tournament_id, status, created_at desc);

create table player_price_history (
  pricing_run_id text not null references pricing_runs(id) on delete cascade,
  tournament_id text not null references tournaments(id) on delete cascade,
  player_id text not null references players(id) on delete cascade,
  gameweek_id text not null references gameweeks(id) on delete cascade,
  previous_price_cents bigint not null,
  current_price_cents bigint not null,
  change_cents bigint not null,
  fair_price_cents bigint not null,
  season_points_percentile double precision not null,
  recent_form_percentile double precision not null,
  points_per_appearance_percentile double precision not null,
  performance_index double precision not null,
  adjusted_performance double precision not null,
  confidence double precision not null,
  season_points integer not null,
  recent_form double precision not null,
  points_per_appearance double precision not null,
  participation_rate double precision,
  formula_version text not null,
  effective_at timestamptz not null,
  market_momentum double precision not null default 0,
  primary key (pricing_run_id, player_id)
);
create index player_price_history_lookup_idx on player_price_history(tournament_id, player_id, effective_at desc);
create unique index player_price_history_period_version_uidx on player_price_history(tournament_id, player_id, gameweek_id, formula_version);
create index player_price_history_gameweek_idx on player_price_history(tournament_id, gameweek_id, formula_version);

create function initialize_tournament_player_price() returns trigger language plpgsql as $$
begin
  if new.initial_price_cents = 0 then
    new.initial_price_cents := new.price_cents;
  end if;
  return new;
end;
$$;
create trigger tournament_players_initialize_price before insert on tournament_players
for each row execute function initialize_tournament_player_price();

-- The browser must never query these tables with Supabase's anon/authenticated roles.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'users','sessions','profiles','tournaments','clubs','players','tournament_players',
    'fantasy_teams','squad_players','lineups','lineup_players','leagues','league_memberships',
    'transfers','transfer_items','club_external_ids','player_external_ids','matches',
    'match_external_ids','player_match_stats','source_observations','sync_runs','player_club_history',
    'tournament_roster_registrations','gameweeks','onboarding_drafts','team_reward_state',
    'team_chips','reward_milestone_claims','quest_progress','chest_claims',
    'player_fantasy_points','team_gameweek_scores','pricing_runs','player_price_history'
  ] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('revoke all on table %I from anon, authenticated', table_name);
  end loop;
end;
$$;
