import dotenv from 'dotenv';
import { createPostgresDatabase } from '../server/postgres/client.js';

dotenv.config({ path: '.env.supabase.local' });
const connection = new URL(process.env.DATABASE_URL ?? process.env.DIRECT_URL ?? '');
// A transaction pooler is sufficient for this read-only inventory.
if (connection.hostname.endsWith('.pooler.supabase.com') && connection.port === '5432') connection.port = '6543';
const db = createPostgresDatabase({ url: connection.toString() });
try {
  const tables = await db.query(`select table_name from information_schema.tables
    where table_schema='public' and table_name in
    ('users','sessions','profiles','fantasy_teams','squad_players','lineups','lineup_players',
     'leagues','league_memberships','transfers','transfer_items','team_gameweek_scores',
     'tournaments','gameweeks','clubs','players','tournament_players','pipeline_runs','admin_user_roles')
    order by table_name`);
  const roles = await db.query(`select rolname,rolcanlogin,rolbypassrls from pg_roles
    where rolname in ('fantasy_lpf_app','fantasy_lpf_admin_reader','anon','authenticated')
    order by rolname`);
  const migrations = await db.query(`select version from app_schema_migrations order by version desc limit 3`);
  console.log(JSON.stringify({ tables, roles, migrations }, null, 2));
} finally { await db.close(); }
