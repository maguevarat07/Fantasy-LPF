import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type SqliteDatabase = Database.Database;

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user_id_idx ON sessions(user_id);
  CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

  CREATE TABLE profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    manager_name TEXT NOT NULL,
    province TEXT NOT NULL DEFAULT '',
    favorite_club_id TEXT,
    avatar_url TEXT NOT NULL DEFAULT '',
    notifications_enabled INTEGER NOT NULL DEFAULT 1 CHECK (notifications_enabled IN (0, 1)),
    email_alerts_enabled INTEGER NOT NULL DEFAULT 1 CHECK (email_alerts_enabled IN (0, 1)),
    updated_at TEXT NOT NULL
  );

  CREATE TABLE tournaments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('UPCOMING', 'ACTIVE', 'FINISHED')),
    budget_cents INTEGER NOT NULL DEFAULT 10000000000 CHECK (budget_cents >= 0),
    starts_at TEXT,
    ends_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE clubs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
  );

  CREATE TABLE players (
    id TEXT PRIMARY KEY,
    club_id TEXT REFERENCES clubs(id),
    name TEXT NOT NULL,
    position TEXT CHECK (position IN ('GK', 'DEF', 'MID', 'FWD')),
    price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INJURED', 'SUSPENDED', 'INACTIVE')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    updated_at TEXT NOT NULL
  );
  CREATE INDEX players_club_idx ON players(club_id);

  CREATE TABLE tournament_players (
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    PRIMARY KEY (tournament_id, player_id)
  );

  CREATE TABLE fantasy_teams (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id),
    name TEXT NOT NULL,
    formation TEXT NOT NULL,
    bank_cents INTEGER NOT NULL CHECK (bank_cents >= 0),
    total_points INTEGER NOT NULL DEFAULT 0,
    gameweek_points INTEGER NOT NULL DEFAULT 0,
    free_transfers INTEGER NOT NULL DEFAULT 1 CHECK (free_transfers >= 0),
    transfer_penalty_points INTEGER NOT NULL DEFAULT 0 CHECK (transfer_penalty_points >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, tournament_id)
  );
  CREATE INDEX fantasy_teams_tournament_idx ON fantasy_teams(tournament_id);

  CREATE TABLE squad_players (
    fantasy_team_id TEXT NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(id),
    purchase_price_cents INTEGER NOT NULL CHECK (purchase_price_cents >= 0),
    acquired_at TEXT NOT NULL,
    PRIMARY KEY (fantasy_team_id, player_id)
  );

  CREATE TABLE lineups (
    fantasy_team_id TEXT NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
    gameweek_id TEXT NOT NULL,
    formation TEXT NOT NULL,
    captain_player_id TEXT NOT NULL REFERENCES players(id),
    vice_captain_player_id TEXT NOT NULL REFERENCES players(id),
    submitted_at TEXT NOT NULL,
    PRIMARY KEY (fantasy_team_id, gameweek_id),
    CHECK (captain_player_id <> vice_captain_player_id)
  );

  CREATE TABLE lineup_players (
    fantasy_team_id TEXT NOT NULL,
    gameweek_id TEXT NOT NULL,
    player_id TEXT NOT NULL REFERENCES players(id),
    role TEXT NOT NULL CHECK (role IN ('STARTER', 'BENCH')),
    slot INTEGER NOT NULL,
    PRIMARY KEY (fantasy_team_id, gameweek_id, player_id),
    UNIQUE (fantasy_team_id, gameweek_id, role, slot),
    FOREIGN KEY (fantasy_team_id, gameweek_id)
      REFERENCES lineups(fantasy_team_id, gameweek_id) ON DELETE CASCADE
  );

  CREATE TABLE leagues (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    code TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE INDEX leagues_tournament_idx ON leagues(tournament_id);

  CREATE TABLE league_memberships (
    league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    fantasy_team_id TEXT NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (league_id, fantasy_team_id)
  );

  CREATE TABLE transfers (
    id TEXT PRIMARY KEY,
    fantasy_team_id TEXT NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
    gameweek_id TEXT NOT NULL,
    bank_before_cents INTEGER NOT NULL,
    bank_after_cents INTEGER NOT NULL,
    points_cost INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX transfers_team_idx ON transfers(fantasy_team_id, created_at);

  CREATE TABLE transfer_items (
    transfer_id TEXT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
    player_out_id TEXT NOT NULL REFERENCES players(id),
    player_in_id TEXT NOT NULL REFERENCES players(id),
    sell_price_cents INTEGER NOT NULL,
    buy_price_cents INTEGER NOT NULL,
    PRIMARY KEY (transfer_id, player_out_id),
    UNIQUE (transfer_id, player_in_id)
  );
  `,
  `
  ALTER TABLE clubs ADD COLUMN normalized_name TEXT;
  ALTER TABLE players ADD COLUMN display_name TEXT;
  ALTER TABLE players ADD COLUMN normalized_name TEXT;
  ALTER TABLE players ADD COLUMN date_of_birth TEXT;
  ALTER TABLE players ADD COLUMN nationality TEXT;
  ALTER TABLE players ADD COLUMN shirt_number INTEGER;
  ALTER TABLE players ADD COLUMN image_url TEXT;

  CREATE UNIQUE INDEX clubs_normalized_name_idx ON clubs(normalized_name) WHERE normalized_name IS NOT NULL;
  CREATE INDEX players_identity_idx ON players(normalized_name, club_id);

  CREATE TABLE club_external_ids (
    club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (source, external_id),
    UNIQUE (club_id, source)
  );

  CREATE TABLE player_external_ids (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (source, external_id),
    UNIQUE (player_id, source)
  );

  CREATE TABLE matches (
    id TEXT PRIMARY KEY,
    home_club_id TEXT REFERENCES clubs(id),
    away_club_id TEXT REFERENCES clubs(id),
    home_club_name TEXT NOT NULL,
    away_club_name TEXT NOT NULL,
    starts_at TEXT,
    home_score INTEGER,
    away_score INTEGER,
    round TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE match_external_ids (
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (source, external_id),
    UNIQUE (match_id, source)
  );

  CREATE TABLE player_match_stats (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    starter INTEGER CHECK (starter IN (0, 1)),
    substitute_in INTEGER CHECK (substitute_in IN (0, 1)),
    minutes INTEGER,
    goals INTEGER,
    assists INTEGER,
    yellow_cards INTEGER,
    red_cards INTEGER,
    own_goals INTEGER,
    saves INTEGER,
    source_url TEXT NOT NULL,
    external_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (player_id, match_id),
    UNIQUE (source, external_id)
  );

  CREATE TABLE source_observations (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    external_entity_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    parser_version TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    value_json TEXT NOT NULL,
    UNIQUE (source, entity_type, external_entity_id, parser_version, content_hash)
  );

  CREATE TABLE sync_runs (
    run_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    job TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    status TEXT NOT NULL,
    records_found INTEGER NOT NULL,
    records_created INTEGER NOT NULL,
    records_updated INTEGER NOT NULL,
    conflicts INTEGER NOT NULL,
    errors_json TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE profiles ADD COLUMN phone TEXT NOT NULL DEFAULT '';
  `,
  `
  CREATE TABLE player_club_history (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    from_club_id TEXT REFERENCES clubs(id),
    to_club_id TEXT REFERENCES clubs(id),
    source TEXT NOT NULL,
    source_url TEXT NOT NULL,
    detected_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE UNIQUE INDEX player_club_history_open_idx
    ON player_club_history(player_id, source) WHERE ended_at IS NULL;

  CREATE TABLE tournament_roster_registrations (
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    club_id TEXT NOT NULL REFERENCES clubs(id),
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    ended_at TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    PRIMARY KEY (tournament_id, player_id, source)
  );
  CREATE INDEX tournament_roster_active_idx
    ON tournament_roster_registrations(tournament_id, source, active);
  `,
  `
  CREATE TABLE gameweeks (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    name TEXT NOT NULL,
    starts_at TEXT,
    deadline_at TEXT NOT NULL,
    ends_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('OPEN', 'LOCKED', 'LIVE', 'FINISHED')),
    UNIQUE (tournament_id, week_number)
  );
  CREATE INDEX gameweeks_tournament_status_idx ON gameweeks(tournament_id, status, week_number);

  CREATE TABLE onboarding_drafts (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    step INTEGER NOT NULL CHECK (step BETWEEN 1 AND 6),
    team_name TEXT,
    province TEXT,
    favorite_club_id TEXT,
    formation TEXT,
    selected_player_ids_json TEXT NOT NULL DEFAULT '[]',
    starters_json TEXT NOT NULL DEFAULT '[]',
    bench_json TEXT NOT NULL DEFAULT '[]',
    captain_player_id TEXT,
    vice_captain_player_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, tournament_id)
  );

  CREATE TABLE team_reward_state (
    fantasy_team_id TEXT PRIMARY KEY REFERENCES fantasy_teams(id) ON DELETE CASCADE,
    mastery_xp INTEGER NOT NULL DEFAULT 0 CHECK (mastery_xp >= 0),
    tactical_coins INTEGER NOT NULL DEFAULT 0 CHECK (tactical_coins >= 0),
    updated_at TEXT NOT NULL
  );

  CREATE TABLE team_chips (
    fantasy_team_id TEXT NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
    chip_id TEXT NOT NULL CHECK (chip_id IN ('wildcard', 'triple_cap', 'bench_boost', 'emergency_fund')),
    unlocked_at TEXT,
    active_gameweek_id TEXT REFERENCES gameweeks(id),
    used_gameweek_id TEXT REFERENCES gameweeks(id),
    activated_at TEXT,
    PRIMARY KEY (fantasy_team_id, chip_id)
  );
  CREATE UNIQUE INDEX one_active_chip_per_gameweek_idx
    ON team_chips(fantasy_team_id, active_gameweek_id) WHERE active_gameweek_id IS NOT NULL;

  CREATE TABLE reward_milestone_claims (
    fantasy_team_id TEXT NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
    milestone_id TEXT NOT NULL,
    claimed_at TEXT NOT NULL,
    PRIMARY KEY (fantasy_team_id, milestone_id)
  );

  CREATE TABLE quest_progress (
    fantasy_team_id TEXT NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
    gameweek_id TEXT NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
    quest_id TEXT NOT NULL,
    completed_at TEXT,
    claimed_at TEXT,
    xp_awarded INTEGER NOT NULL DEFAULT 0 CHECK (xp_awarded >= 0),
    PRIMARY KEY (fantasy_team_id, gameweek_id, quest_id)
  );

  CREATE TABLE chest_claims (
    fantasy_team_id TEXT NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
    gameweek_id TEXT NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
    xp_awarded INTEGER NOT NULL CHECK (xp_awarded >= 0),
    budget_awarded_cents INTEGER NOT NULL CHECK (budget_awarded_cents >= 0),
    claimed_at TEXT NOT NULL,
    PRIMARY KEY (fantasy_team_id, gameweek_id)
  );
  `,
  `
  ALTER TABLE matches ADD COLUMN gameweek_id TEXT REFERENCES gameweeks(id);
  ALTER TABLE matches ADD COLUMN score_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (score_status IN ('PENDING', 'PROVISIONAL', 'CONFIRMED', 'CORRECTED'));
  ALTER TABLE player_match_stats ADD COLUMN club_id TEXT REFERENCES clubs(id);
  ALTER TABLE player_match_stats ADD COLUMN assist_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (assist_status IN ('PENDING', 'PROVISIONAL', 'CONFIRMED', 'CORRECTED'));

  CREATE TABLE player_fantasy_points (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    gameweek_id TEXT NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
    participation_points INTEGER NOT NULL,
    goal_points INTEGER NOT NULL,
    assist_points INTEGER NOT NULL,
    clean_sheet_points INTEGER NOT NULL,
    yellow_card_points INTEGER NOT NULL,
    red_card_points INTEGER NOT NULL,
    own_goal_points INTEGER NOT NULL,
    total_points INTEGER NOT NULL,
    input_hash TEXT NOT NULL,
    calculation_version TEXT NOT NULL,
    calculated_at TEXT NOT NULL,
    PRIMARY KEY (player_id, match_id)
  );
  CREATE INDEX player_fantasy_points_gameweek_idx ON player_fantasy_points(gameweek_id, player_id);

  CREATE TABLE team_gameweek_scores (
    fantasy_team_id TEXT NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
    gameweek_id TEXT NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
    player_points INTEGER NOT NULL,
    captain_bonus INTEGER NOT NULL,
    transfer_penalty INTEGER NOT NULL,
    total_points INTEGER NOT NULL,
    input_hash TEXT NOT NULL,
    calculation_version TEXT NOT NULL,
    calculated_at TEXT NOT NULL,
    PRIMARY KEY (fantasy_team_id, gameweek_id)
  );
  `,
  `
  ALTER TABLE tournament_players ADD COLUMN previous_price_cents INTEGER;
  ALTER TABLE tournament_players ADD COLUMN price_updated_at TEXT;
  ALTER TABLE tournament_players ADD COLUMN pricing_version TEXT;

  CREATE TABLE pricing_runs (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    as_of_gameweek_id TEXT NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
    formula_version TEXT NOT NULL,
    config_json TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
    created_at TEXT NOT NULL,
    completed_at TEXT,
    UNIQUE (tournament_id, as_of_gameweek_id, formula_version, input_hash)
  );
  CREATE INDEX pricing_runs_lookup_idx
    ON pricing_runs(tournament_id, as_of_gameweek_id, formula_version, created_at DESC);

  CREATE TABLE player_price_history (
    pricing_run_id TEXT NOT NULL REFERENCES pricing_runs(id) ON DELETE CASCADE,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    gameweek_id TEXT NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
    previous_price_cents INTEGER NOT NULL,
    current_price_cents INTEGER NOT NULL,
    change_cents INTEGER NOT NULL,
    fair_price_cents INTEGER NOT NULL,
    season_points_percentile REAL NOT NULL,
    recent_form_percentile REAL NOT NULL,
    points_per_appearance_percentile REAL NOT NULL,
    performance_index REAL NOT NULL,
    adjusted_performance REAL NOT NULL,
    confidence REAL NOT NULL,
    season_points INTEGER NOT NULL,
    recent_form REAL NOT NULL,
    points_per_appearance REAL NOT NULL,
    participation_rate REAL,
    formula_version TEXT NOT NULL,
    effective_at TEXT NOT NULL,
    PRIMARY KEY (pricing_run_id, player_id)
  );
  CREATE INDEX player_price_history_lookup_idx
    ON player_price_history(tournament_id, player_id, effective_at DESC);
  `,
  `
  ALTER TABLE tournament_players ADD COLUMN initial_price_cents INTEGER NOT NULL DEFAULT 0
    CHECK (initial_price_cents >= 0);
  ALTER TABLE tournament_players ADD COLUMN fair_price_cents INTEGER
    CHECK (fair_price_cents IS NULL OR fair_price_cents >= 0);
  ALTER TABLE tournament_players ADD COLUMN last_change_cents INTEGER;
  ALTER TABLE tournament_players ADD COLUMN last_calculated_gameweek_id TEXT
    REFERENCES gameweeks(id);
  ALTER TABLE tournament_players ADD COLUMN pricing_status TEXT NOT NULL DEFAULT 'LEGACY'
    CHECK (pricing_status IN ('LEGACY', 'CURRENT', 'STALE', 'ERROR'));

  UPDATE tournament_players
  SET initial_price_cents = price_cents
  WHERE initial_price_cents = 0;

  CREATE TRIGGER tournament_players_initialize_price
  AFTER INSERT ON tournament_players
  WHEN NEW.initial_price_cents = 0
  BEGIN
    UPDATE tournament_players
    SET initial_price_cents = NEW.price_cents
    WHERE tournament_id = NEW.tournament_id AND player_id = NEW.player_id;
  END;

  ALTER TABLE squad_players ADD COLUMN purchase_gameweek_id TEXT
    REFERENCES gameweeks(id);

  CREATE INDEX squad_players_player_idx ON squad_players(player_id);
  CREATE INDEX squad_players_purchase_gameweek_idx
    ON squad_players(purchase_gameweek_id, fantasy_team_id);
  CREATE UNIQUE INDEX player_price_history_period_version_uidx
    ON player_price_history(tournament_id, player_id, gameweek_id, formula_version);
  CREATE INDEX player_price_history_gameweek_idx
    ON player_price_history(tournament_id, gameweek_id, formula_version);
  CREATE INDEX pricing_runs_status_idx
    ON pricing_runs(tournament_id, status, created_at DESC);

  ALTER TABLE player_price_history ADD COLUMN market_momentum REAL NOT NULL DEFAULT 0;
  `,
  `
  ALTER TABLE transfer_items ADD COLUMN purchase_price_cents INTEGER
    CHECK (purchase_price_cents IS NULL OR purchase_price_cents >= 0);
  ALTER TABLE transfer_items ADD COLUMN profit_loss_cents INTEGER;
  ALTER TABLE transfer_items ADD COLUMN purchase_gameweek_id TEXT
    REFERENCES gameweeks(id);
  `,
  `
  ALTER TABLE transfers ADD COLUMN status TEXT NOT NULL DEFAULT 'CONFIRMED'
    CHECK (status IN ('CONFIRMED', 'PENDING', 'FAILED', 'REVERTED'));
  ALTER TABLE transfers ADD COLUMN operation_origin TEXT NOT NULL DEFAULT 'USER'
    CHECK (operation_origin IN ('USER', 'INITIAL_SQUAD', 'BENCH', 'SEED', 'TEST', 'ADMIN'));
  ALTER TABLE transfers ADD COLUMN confirmed_at TEXT;
  ALTER TABLE transfers ADD COLUMN reverted_at TEXT;
  ALTER TABLE transfers ADD COLUMN wildcard_used INTEGER NOT NULL DEFAULT 0
    CHECK (wildcard_used IN (0, 1));

  UPDATE transfers SET confirmed_at = created_at
  WHERE status = 'CONFIRMED' AND confirmed_at IS NULL;

  CREATE INDEX transfers_momentum_window_idx
    ON transfers(status, operation_origin, confirmed_at, fantasy_team_id);
  `,
  `
  UPDATE tournament_players SET price_cents = MIN(900000000, MAX(400000000,
      CAST(ROUND(price_cents / 10000000.0) * 10000000 AS INTEGER)))
    WHERE pricing_status = 'LEGACY' AND player_id IN (SELECT id FROM players WHERE position = 'GK');
  UPDATE tournament_players SET price_cents = MIN(1000000000, MAX(400000000,
      CAST(ROUND(price_cents / 10000000.0) * 10000000 AS INTEGER)))
    WHERE pricing_status = 'LEGACY' AND player_id IN (SELECT id FROM players WHERE position = 'DEF');
  UPDATE tournament_players SET price_cents = MIN(1400000000, MAX(450000000,
      CAST(ROUND(price_cents / 10000000.0) * 10000000 AS INTEGER)))
    WHERE pricing_status = 'LEGACY' AND player_id IN (SELECT id FROM players WHERE position = 'MID');
  UPDATE tournament_players SET price_cents = MIN(1800000000, MAX(500000000,
      CAST(ROUND(price_cents / 10000000.0) * 10000000 AS INTEGER)))
    WHERE pricing_status = 'LEGACY' AND player_id IN (SELECT id FROM players WHERE position = 'FWD');
  UPDATE tournament_players SET initial_price_cents = price_cents
    WHERE pricing_status = 'LEGACY';
  `,
  `
  ALTER TABLE pricing_runs ADD COLUMN input_snapshot_json TEXT;
  `,
];

export interface OpenDatabaseOptions {
  filename?: string;
}

export function openDatabase(options: OpenDatabaseOptions = {}): SqliteDatabase {
  const filename = options.filename ?? process.env.DATABASE_PATH ?? resolve(process.cwd(), 'data', 'fantasy-lpf.sqlite');
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });

  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  repairScoringSchema(db);
  return db;
}

function hasColumn(db: SqliteDatabase, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(item => item.name === column);
}

function repairScoringSchema(db: SqliteDatabase): void {
  db.transaction(() => {
    if (!hasColumn(db, 'matches', 'gameweek_id')) db.exec('ALTER TABLE matches ADD COLUMN gameweek_id TEXT REFERENCES gameweeks(id)');
    if (!hasColumn(db, 'matches', 'score_status')) db.exec("ALTER TABLE matches ADD COLUMN score_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (score_status IN ('PENDING','PROVISIONAL','CONFIRMED','CORRECTED'))");
    if (!hasColumn(db, 'player_match_stats', 'club_id')) db.exec('ALTER TABLE player_match_stats ADD COLUMN club_id TEXT REFERENCES clubs(id)');
    if (!hasColumn(db, 'player_match_stats', 'assist_status')) db.exec("ALTER TABLE player_match_stats ADD COLUMN assist_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (assist_status IN ('PENDING','PROVISIONAL','CONFIRMED','CORRECTED'))");
    db.exec(`
      CREATE TABLE IF NOT EXISTS player_fantasy_points (
        player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        gameweek_id TEXT NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
        participation_points INTEGER NOT NULL, goal_points INTEGER NOT NULL, assist_points INTEGER NOT NULL,
        clean_sheet_points INTEGER NOT NULL, yellow_card_points INTEGER NOT NULL, red_card_points INTEGER NOT NULL,
        own_goal_points INTEGER NOT NULL, total_points INTEGER NOT NULL, input_hash TEXT NOT NULL,
        calculation_version TEXT NOT NULL, calculated_at TEXT NOT NULL, PRIMARY KEY (player_id, match_id)
      );
      CREATE INDEX IF NOT EXISTS player_fantasy_points_gameweek_idx ON player_fantasy_points(gameweek_id, player_id);
      CREATE TABLE IF NOT EXISTS team_gameweek_scores (
        fantasy_team_id TEXT NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
        gameweek_id TEXT NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
        player_points INTEGER NOT NULL, captain_bonus INTEGER NOT NULL, transfer_penalty INTEGER NOT NULL,
        total_points INTEGER NOT NULL, input_hash TEXT NOT NULL, calculation_version TEXT NOT NULL,
        calculated_at TEXT NOT NULL, PRIMARY KEY (fantasy_team_id, gameweek_id)
      );
    `);
  })();
}

export function migrate(db: SqliteDatabase): void {
  const current = Number(db.pragma('user_version', { simple: true }));
  if (current > MIGRATIONS.length) {
    throw new Error(`La base de datos usa una versión futura (${current}).`);
  }

  for (let index = current; index < MIGRATIONS.length; index += 1) {
    db.transaction(() => {
      db.exec(MIGRATIONS[index]);
      db.pragma(`user_version = ${index + 1}`);
    })();
  }
}

export function seedTournament(
  db: SqliteDatabase,
  tournament: { id: string; name: string; status?: 'UPCOMING' | 'ACTIVE' | 'FINISHED'; budgetCents?: number },
): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO tournaments (id, name, status, budget_cents, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status,
      budget_cents = excluded.budget_cents
  `).run(tournament.id, tournament.name, tournament.status ?? 'ACTIVE', tournament.budgetCents ?? 10_000_000_000, now);
}

export function seedGameweek(
  db: SqliteDatabase,
  gameweek: {
    id: string;
    tournamentId: string;
    weekNumber: number;
    name: string;
    deadlineAt: string;
    status?: 'OPEN' | 'LOCKED' | 'LIVE' | 'FINISHED';
    startsAt?: string | null;
    endsAt?: string | null;
  },
): void {
  db.prepare(`INSERT INTO gameweeks
    (id, tournament_id, week_number, name, starts_at, deadline_at, ends_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, starts_at = excluded.starts_at,
      deadline_at = excluded.deadline_at, ends_at = excluded.ends_at, status = excluded.status`)
    .run(gameweek.id, gameweek.tournamentId, gameweek.weekNumber, gameweek.name,
      gameweek.startsAt ?? null, gameweek.deadlineAt, gameweek.endsAt ?? null, gameweek.status ?? 'OPEN');
}

export { canonicalDataRepository, createCanonicalDataRepository } from './canonicalRepository.js';
