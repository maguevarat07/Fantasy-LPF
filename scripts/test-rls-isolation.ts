import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { createPostgresDatabase, type PostgresTransaction } from '../server/postgres/client.js';
import { applicationDatabase } from '../server/applicationDatabase.js';

config({ path: '.env.supabase.local' });
const db = createPostgresDatabase({ url: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
const rollback = Symbol('rollback');
const check = (value: unknown, label: string) => {
  if (!value) throw new Error(`FAIL: ${label}`);
  process.stdout.write(`PASS: ${label}\n`);
};

async function run() {
  try {
    await db.transaction(async tx => {
      const security = await tx.one<{ bypass: boolean; policies: number; anon: boolean; authenticated: boolean; publicWrite: boolean }>(`
        select (select rolbypassrls from pg_roles where rolname='fantasy_lpf_app') as bypass,
          (select count(*)::int from pg_policies where schemaname='public' and roles @> array['fantasy_lpf_app'::name]) as policies,
          has_table_privilege('anon','public.app_schema_migrations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon,
          has_table_privilege('authenticated','public.app_schema_migrations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as authenticated,
          has_table_privilege('fantasy_lpf_app','public.players','INSERT,UPDATE,DELETE') as "publicWrite"`);
      check(!security.bypass && security.policies >= 35, 'rol sin BYPASSRLS y políticas instaladas');
      check(!security.anon && !security.authenticated, 'migraciones cerradas a anon/authenticated');
      check(!security.publicWrite, 'catálogo deportivo sin escritura desde rol app');
      const jobAccess = await tx.one<{ role: string; canSync: boolean; canScore: boolean; canPrice: boolean }>(`
        select current_user as role,
          has_table_privilege(current_user,'public.sync_runs','SELECT,INSERT,UPDATE') as "canSync",
          has_table_privilege(current_user,'public.player_fantasy_points','SELECT,INSERT,UPDATE') as "canScore",
          has_table_privilege(current_user,'public.pricing_runs','SELECT,INSERT,UPDATE') as "canPrice"`);
      check(jobAccess.role === 'postgres' && jobAccess.canSync && jobAccess.canScore && jobAccess.canPrice,
        'rol interno conserva privilegios de sync, scoring y pricing');
      const tournament = await tx.one<{ id: string }>('select id from tournaments limit 1');
      const gameweek = await tx.one<{ id: string }>('select id from gameweeks where tournament_id=$1 limit 1', [tournament.id]);
      const players = await tx.query<{ id: string }>('select id from players limit 2');
      check(players.length === 2, 'fixture deportiva disponible');
      const [a, b, ta, tb, league, transferA, transferB] = Array.from({ length: 7 }, () => randomUUID());
      const now = new Date().toISOString();
      for (const [user, team] of [[a, ta], [b, tb]]) {
        await tx.execute('insert into users(id,email,username,password_hash,created_at,updated_at) values($1,$2,$3,$4,$5,$5)',
          [user, `${user}@qa.invalid`, `rls_${user.slice(0, 12)}`, 'qa-only-rollback', now]);
        await tx.execute('insert into profiles(user_id,manager_name,updated_at) values($1,$2,$3)',
          [user, `RLS ${user.slice(0, 4)}`, now]);
        await tx.execute(`insert into fantasy_teams(id,user_id,tournament_id,name,formation,bank_cents,created_at,updated_at)
          values($1,$2,$3,$4,'4-3-3',100000000,$5,$5)`, [team, user, tournament.id, `RLS ${team.slice(0, 4)}`, now]);
        await tx.execute('insert into squad_players(fantasy_team_id,player_id,purchase_price_cents,acquired_at) values($1,$2,500000000,$3)',
          [team, players[0].id, now]);
        await tx.execute(`insert into lineups(fantasy_team_id,gameweek_id,formation,captain_player_id,vice_captain_player_id,submitted_at)
          values($1,$2,'4-3-3',$3,$4,$5)`, [team, gameweek.id, players[0].id, players[1].id, now]);
        await tx.execute(`insert into lineup_players(fantasy_team_id,gameweek_id,player_id,role,slot)
          values($1,$2,$3,'STARTER',0)`, [team, gameweek.id, players[0].id]);
      }
      await tx.execute('insert into leagues(id,tournament_id,owner_user_id,name,code,created_at) values($1,$2,$3,$4,$5,$6)',
        [league, tournament.id, a, 'RLS shared QA', `R${league.slice(0, 5)}`, now]);
      await tx.execute('insert into league_memberships(league_id,fantasy_team_id,joined_at) values($1,$2,$3),($1,$4,$3)',
        [league, ta, now, tb]);
      for (const [transfer, team] of [[transferA, ta], [transferB, tb]]) {
        await tx.execute(`insert into transfers(id,fantasy_team_id,gameweek_id,bank_before_cents,bank_after_cents,created_at)
          values($1,$2,$3,100000000,100000000,$4)`, [transfer, team, gameweek.id, now]);
        await tx.execute(`insert into transfer_items(transfer_id,player_out_id,player_in_id,sell_price_cents,buy_price_cents)
          values($1,$2,$3,500000000,500000000)`, [transfer, players[0].id, players[1].id]);
      }

      const asUser = async (user: string, work: () => Promise<void>) => {
        await tx.execute('SET LOCAL ROLE fantasy_lpf_app');
        await tx.execute("SELECT set_config('app.user_id',$1,true)", [user]);
        try { await work(); } finally { await tx.execute('SET LOCAL ROLE NONE'); }
      };
      await asUser(a, async () => {
        for (const [table, idColumn, own, other] of [
          ['fantasy_teams','id',ta,tb], ['squad_players','fantasy_team_id',ta,tb],
          ['lineups','fantasy_team_id',ta,tb], ['lineup_players','fantasy_team_id',ta,tb],
          ['transfers','id',transferA,transferB], ['transfer_items','transfer_id',transferA,transferB],
          ['league_memberships','fantasy_team_id',ta,tb],
        ]) {
          const rows = await tx.query<{ id: string }>(`select ${idColumn} as id from ${table}`);
          check(rows.some(row => row.id === own) && rows.every(row => row.id !== other), `A solo lee su ${table}, incluso sin WHERE`);
        }
        check((await tx.query('select id from fantasy_teams where id=$1', [tb])).length === 0, 'A no lee equipo B');
        check(await tx.execute('update fantasy_teams set name=name where id=$1', [ta]) === 1, 'A actualiza equipo A');
        check(await tx.execute('update fantasy_teams set name=name where id=$1', [tb]) === 0, 'A no actualiza equipo B');
        check(await tx.execute('delete from squad_players where fantasy_team_id=$1', [tb]) === 0, 'A no elimina plantilla B');
        check(await tx.execute('delete from league_memberships where fantasy_team_id=$1', [tb]) === 0, 'A no elimina membresía B');
        check((await tx.query('select * from app_league_leaderboard($1,$2)', [league, gameweek.id])).length === 2,
          'miembro ve resumen compartido de liga');
        check((await tx.query('select * from profiles')).length === 1, 'perfil privado de B oculto');
      });
      await asUser(b, async () => {
        check((await tx.query('select id from fantasy_teams')).length === 1, 'B solo lee su equipo sin WHERE');
        check((await tx.query('select * from transfers where id=$1', [transferA])).length === 0, 'B no lee transferencias A');
        check(await tx.execute('update profiles set manager_name=manager_name where user_id=$1', [a]) === 0,
          'B no actualiza perfil A');
        check((await tx.query('select * from app_leagues_for_user($1)', [tournament.id])).some(row => row.id === league),
          'B ve su liga compartida');
      });
      await tx.execute('SET LOCAL ROLE fantasy_lpf_app');
      await tx.execute("SELECT set_config('app.user_id','',true)");
      check((await tx.query('select id from fantasy_teams')).length === 0, 'sin contexto no hay equipos');
      await tx.execute('SET LOCAL ROLE NONE');

      // Exercise the exact backend wrapper with a deliberately unfiltered query.
      const wrapper = applicationDatabase({
        ...tx,
        transaction: async <T>(work: (nested: PostgresTransaction) => Promise<T>) => work(tx),
        close: async () => {},
      }, { enforceRls: true });
      await wrapper.withUser(a, async () => {
        const rows = await wrapper.prepare('SELECT id FROM fantasy_teams').all();
        check(rows.length === 1 && rows[0].id === ta, 'escape backend sin WHERE bloqueado por RLS');
      });
      await tx.execute('SET LOCAL ROLE NONE');
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await db.close();
  }
  process.stdout.write('All QA fixtures rolled back.\n');
}

run().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
