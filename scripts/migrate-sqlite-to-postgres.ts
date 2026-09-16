import 'dotenv/config';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { createPostgresDatabase, type PostgresDatabase, type QueryRow, type SqlParameter } from '../server/postgres/client.js';
import { createHttpPostgresDatabase } from './httpPostgresClient.js';

interface TablePlan { name: string; primaryKey: string[] }

const TABLES: readonly TablePlan[] = [
  { name: 'tournaments', primaryKey: ['id'] },
  { name: 'users', primaryKey: ['id'] },
  { name: 'clubs', primaryKey: ['id'] },
  { name: 'profiles', primaryKey: ['user_id'] },
  { name: 'sessions', primaryKey: ['id'] },
  { name: 'players', primaryKey: ['id'] },
  { name: 'gameweeks', primaryKey: ['id'] },
  { name: 'tournament_players', primaryKey: ['tournament_id', 'player_id'] },
  { name: 'club_external_ids', primaryKey: ['source', 'external_id'] },
  { name: 'player_external_ids', primaryKey: ['source', 'external_id'] },
  { name: 'player_club_history', primaryKey: ['id'] },
  { name: 'tournament_roster_registrations', primaryKey: ['tournament_id', 'player_id', 'source'] },
  { name: 'matches', primaryKey: ['id'] },
  { name: 'match_external_ids', primaryKey: ['source', 'external_id'] },
  { name: 'player_match_stats', primaryKey: ['player_id', 'match_id'] },
  { name: 'source_observations', primaryKey: ['id'] },
  { name: 'sync_runs', primaryKey: ['run_id'] },
  { name: 'fantasy_teams', primaryKey: ['id'] },
  { name: 'squad_players', primaryKey: ['fantasy_team_id', 'player_id'] },
  { name: 'lineups', primaryKey: ['fantasy_team_id', 'gameweek_id'] },
  { name: 'lineup_players', primaryKey: ['fantasy_team_id', 'gameweek_id', 'player_id'] },
  { name: 'leagues', primaryKey: ['id'] },
  { name: 'league_memberships', primaryKey: ['league_id', 'fantasy_team_id'] },
  { name: 'transfers', primaryKey: ['id'] },
  { name: 'transfer_items', primaryKey: ['transfer_id', 'player_out_id'] },
  { name: 'onboarding_drafts', primaryKey: ['user_id', 'tournament_id'] },
  { name: 'team_reward_state', primaryKey: ['fantasy_team_id'] },
  { name: 'team_chips', primaryKey: ['fantasy_team_id', 'chip_id'] },
  { name: 'reward_milestone_claims', primaryKey: ['fantasy_team_id', 'milestone_id'] },
  { name: 'quest_progress', primaryKey: ['fantasy_team_id', 'gameweek_id', 'quest_id'] },
  { name: 'chest_claims', primaryKey: ['fantasy_team_id', 'gameweek_id'] },
  { name: 'player_fantasy_points', primaryKey: ['player_id', 'match_id'] },
  { name: 'team_gameweek_scores', primaryKey: ['fantasy_team_id', 'gameweek_id'] },
  { name: 'pricing_runs', primaryKey: ['id'] },
  { name: 'player_price_history', primaryKey: ['pricing_run_id', 'player_id'] },
] as const;

const BOOLEAN_COLUMNS = new Set([
  'profiles.notifications_enabled', 'profiles.email_alerts_enabled',
  'clubs.active', 'players.active', 'tournament_players.active',
  'player_match_stats.starter', 'player_match_stats.substitute_in',
  'tournament_roster_registrations.active', 'transfers.wildcard_used',
]);

const JSON_COLUMNS = new Set([
  'source_observations.value_json', 'sync_runs.errors_json',
  'onboarding_drafts.selected_player_ids_json', 'onboarding_drafts.starters_json',
  'onboarding_drafts.bench_json', 'pricing_runs.config_json',
]);

// The local QA account predates the canonical LPF club import and stores the
// old short identifier. Preserve the user's choice while moving to the real
// club primary key used by the canonical catalog.
const LEGACY_CLUB_IDS: Readonly<Record<string, string>> = {
  tau: '1655a8ae-7610-4853-90e4-d2a4b6baa6f5',
};

const SPANISH_MONTHS: Readonly<Record<string, string>> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
};

function postgresDate(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = /^([a-záéíóú]+)\s+(\d{1,2}),\s*(\d{4})$/i.exec(value.trim());
  if (!match) return null;
  const month = SPANISH_MONTHS[match[1].toLocaleLowerCase('es')];
  const year = Number(match[3]);
  // Several LPF pages expose the article publication date in this field. A
  // 2022-2024 value cannot be a senior player's birth date, so keep it unknown.
  if (!month || year > 2010) return null;
  return `${year}-${month}-${match[2].padStart(2, '0')}`;
}

const AGGREGATES: Readonly<Record<string, readonly string[]>> = {
  tournaments: ['budget_cents'], fantasy_teams: ['bank_cents', 'total_points', 'gameweek_points'],
  squad_players: ['purchase_price_cents'], tournament_players: ['price_cents', 'initial_price_cents', 'fair_price_cents', 'last_change_cents'],
  transfers: ['bank_before_cents', 'bank_after_cents', 'points_cost'],
  transfer_items: ['sell_price_cents', 'buy_price_cents', 'purchase_price_cents', 'profit_loss_cents'],
  player_fantasy_points: ['total_points'], team_gameweek_scores: ['total_points'],
  player_price_history: ['previous_price_cents', 'current_price_cents', 'change_cents', 'fair_price_cents'],
};

function identifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error(`Identificador SQL inválido: ${value}`);
  return `"${value}"`;
}

function sqliteColumns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${identifier(table)})`).all() as Array<{ name: string }>).map(column => column.name);
}

function transformValue(table: string, column: string, value: unknown): SqlParameter {
  if (value === null || value === undefined) return null;
  const key = `${table}.${column}`;
  if (key === 'profiles.favorite_club_id' && typeof value === 'string') {
    return LEGACY_CLUB_IDS[value] ?? value;
  }
  if (key === 'players.date_of_birth' && typeof value === 'string') return postgresDate(value);
  if (BOOLEAN_COLUMNS.has(key)) return Boolean(value);
  if (JSON_COLUMNS.has(key)) {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return JSON.stringify(parsed);
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value instanceof Date || value instanceof Uint8Array) return value;
  throw new Error(`Tipo SQLite no compatible en ${key}: ${typeof value}`);
}

function normalizedKey(table: TablePlan, row: Record<string, unknown>): string {
  return JSON.stringify(table.primaryKey.map(column => row[column] ?? null));
}

function digest(values: readonly string[]): string {
  const hash = createHash('sha256');
  for (const value of [...values].sort()) hash.update(value).update('\n');
  return hash.digest('hex');
}

async function destinationCount(pg: PostgresDatabase, table: string): Promise<number> {
  const row = await pg.one<{ count: string }>(`select count(*)::text as count from ${identifier(table)}`);
  return Number(row.count);
}

async function assertDestinationEmpty(pg: PostgresDatabase): Promise<void> {
  const populated: string[] = [];
  for (const table of TABLES) {
    const count = await destinationCount(pg, table.name);
    if (count > 0) populated.push(`${table.name}=${count}`);
  }
  if (populated.length) {
    throw new Error(`PostgreSQL no está vacío (${populated.join(', ')}). Usa --allow-existing para reanudar una importación.`);
  }
}

async function insertTable(sqlite: Database.Database, pg: PostgresDatabase, table: TablePlan): Promise<number> {
  const columns = sqliteColumns(sqlite, table.name);
  const rows = sqlite.prepare(`select * from ${identifier(table.name)}`).all() as Array<Record<string, unknown>>;
  if (!rows.length) return 0;
  const batchSize = Math.max(1, Number(process.env.MIGRATION_BATCH_SIZE ?? 250));
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    try {
      await pg.transaction(async tx => {
      const parameters: SqlParameter[] = [];
      const tuples = batch.map(row => {
        const placeholders = columns.map(column => {
          parameters.push(transformValue(table.name, column, row[column]));
          return `$${parameters.length}`;
        });
        return `(${placeholders.join(', ')})`;
      });
      const count = await tx.execute(
        `insert into ${identifier(table.name)} (${columns.map(identifier).join(', ')}) values ${tuples.join(', ')} on conflict do nothing`,
        parameters,
      );
      inserted += count;
      });
    } catch (error) {
      throw new Error(
        `Falló ${table.name} en filas ${offset + 1}-${offset + batch.length}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  return inserted;
}

async function validateTable(sqlite: Database.Database, pg: PostgresDatabase, table: TablePlan) {
  const sourceRows = sqlite.prepare(`select ${table.primaryKey.map(identifier).join(', ')} from ${identifier(table.name)}`).all() as Array<Record<string, unknown>>;
  const targetRows = await pg.query(`select ${table.primaryKey.map(identifier).join(', ')} from ${identifier(table.name)}`);
  const sourceDigest = digest(sourceRows.map(row => normalizedKey(table, row)));
  const targetDigest = digest(targetRows.map(row => normalizedKey(table, row)));
  const aggregates: Record<string, { sqlite: string; postgres: string; matches: boolean }> = {};
  for (const column of AGGREGATES[table.name] ?? []) {
    const source = sqlite.prepare(`select coalesce(sum(${identifier(column)}), 0) as value from ${identifier(table.name)}`).get() as { value: number | null };
    const target = await pg.one<{ value: string }>(`select coalesce(sum(${identifier(column)}), 0)::text as value from ${identifier(table.name)}`);
    const sourceValue = String(source.value ?? 0);
    aggregates[column] = { sqlite: sourceValue, postgres: target.value, matches: sourceValue === target.value };
  }
  return {
    sqliteCount: sourceRows.length,
    postgresCount: targetRows.length,
    primaryKeyDigest: { sqlite: sourceDigest, postgres: targetDigest, matches: sourceDigest === targetDigest },
    aggregates,
    matches: sourceRows.length === targetRows.length && sourceDigest === targetDigest
      && Object.values(aggregates).every(value => value.matches),
  };
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const validateOnly = args.has('--validate-only');
  const allowExisting = args.has('--allow-existing');
  const sqlitePath = resolve(process.env.MIGRATION_SQLITE_PATH ?? process.env.DATABASE_PATH ?? 'data/fantasy-lpf.sqlite');
  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const pg = process.env.MIGRATION_HTTP_URL ? createHttpPostgresDatabase() : createPostgresDatabase();
  try {
    const integrity = sqlite.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const foreignKeyErrors = sqlite.pragma('foreign_key_check') as unknown[];
    if (integrity.some(item => item.integrity_check !== 'ok') || foreignKeyErrors.length) {
      throw new Error(`SQLite no supera integridad: ${JSON.stringify({ integrity, foreignKeyErrors })}`);
    }
    if (!validateOnly && !allowExisting) await assertDestinationEmpty(pg);

    const imported: Record<string, number> = {};
    if (!validateOnly) {
      for (const table of TABLES) {
        imported[table.name] = await insertTable(sqlite, pg, table);
        console.log(`[import] ${table.name}: ${imported[table.name]} filas nuevas`);
      }
    }

    const validation: Record<string, Awaited<ReturnType<typeof validateTable>>> = {};
    for (const table of TABLES) validation[table.name] = await validateTable(sqlite, pg, table);
    const failed = Object.entries(validation).filter(([, result]) => !result.matches).map(([name]) => name);
    console.log(JSON.stringify({ sqlitePath, sqliteUserVersion: sqlite.pragma('user_version', { simple: true }), imported, validation, success: failed.length === 0, failed }, null, 2));
    if (failed.length) throw new Error(`Validación PostgreSQL fallida: ${failed.join(', ')}`);
  } finally {
    sqlite.close();
    await pg.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
