-- The API switches to this non-login, non-BYPASSRLS role for every business query.
-- Administrative ingestion and credential verification remain separate.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'fantasy_lpf_app') then
    create role fantasy_lpf_app nologin noinherit nobypassrls;
  end if;
end $$;
grant fantasy_lpf_app to postgres;
grant usage on schema public to fantasy_lpf_app;

create or replace function public.app_user_id() returns text
language sql stable set search_path = pg_catalog, public
as $$ select nullif(current_setting('app.user_id', true), '') $$;
revoke all on function public.app_user_id() from public, anon, authenticated;
grant execute on function public.app_user_id() to fantasy_lpf_app;

-- Public sports data is read-only to the application role.
grant select on public.tournaments, public.clubs, public.players, public.tournament_players,
  public.gameweeks, public.matches, public.player_match_stats, public.player_fantasy_points,
  public.player_price_history to fantasy_lpf_app;
do $$ declare t text; begin
  foreach t in array array['tournaments','clubs','players','tournament_players',
    'gameweeks','matches','player_match_stats','player_fantasy_points','player_price_history'] loop
    execute format('create policy %I on public.%I for select to fantasy_lpf_app using (true)', t || '_public_read', t);
  end loop;
end $$;

-- Account and team data is visible only to its owner. Credential/session rows
-- are never granted to the business role.
grant select, update on public.users, public.profiles to fantasy_lpf_app;
create policy users_owner_select on public.users for select to fantasy_lpf_app
  using (id = public.app_user_id());
create policy users_owner_update on public.users for update to fantasy_lpf_app
  using (id = public.app_user_id()) with check (id = public.app_user_id());
create policy profiles_owner_select on public.profiles for select to fantasy_lpf_app
  using (user_id = public.app_user_id());
create policy profiles_owner_update on public.profiles for update to fantasy_lpf_app
  using (user_id = public.app_user_id()) with check (user_id = public.app_user_id());

grant select, insert, update on public.fantasy_teams to fantasy_lpf_app;
create policy fantasy_teams_owner_select on public.fantasy_teams for select to fantasy_lpf_app
  using (user_id = public.app_user_id());
create policy fantasy_teams_owner_insert on public.fantasy_teams for insert to fantasy_lpf_app
  with check (user_id = public.app_user_id());
create policy fantasy_teams_owner_update on public.fantasy_teams for update to fantasy_lpf_app
  using (user_id = public.app_user_id()) with check (user_id = public.app_user_id());

-- Child-table ownership is derived from fantasy_teams, never from a caller
-- supplied team ID alone. The parent's own RLS policy also applies.
do $$ declare t text; begin
  foreach t in array array['squad_players','lineups','lineup_players','team_reward_state',
    'team_chips','reward_milestone_claims','quest_progress','chest_claims'] loop
    execute format('grant select, insert, update, delete on public.%I to fantasy_lpf_app', t);
    execute format('create policy %I on public.%I for select to fantasy_lpf_app using (exists (select 1 from public.fantasy_teams ft where ft.id = fantasy_team_id and ft.user_id = public.app_user_id()))', t || '_owner_select', t);
    execute format('create policy %I on public.%I for insert to fantasy_lpf_app with check (exists (select 1 from public.fantasy_teams ft where ft.id = fantasy_team_id and ft.user_id = public.app_user_id()))', t || '_owner_insert', t);
    execute format('create policy %I on public.%I for update to fantasy_lpf_app using (exists (select 1 from public.fantasy_teams ft where ft.id = fantasy_team_id and ft.user_id = public.app_user_id())) with check (exists (select 1 from public.fantasy_teams ft where ft.id = fantasy_team_id and ft.user_id = public.app_user_id()))', t || '_owner_update', t);
    execute format('create policy %I on public.%I for delete to fantasy_lpf_app using (exists (select 1 from public.fantasy_teams ft where ft.id = fantasy_team_id and ft.user_id = public.app_user_id()))', t || '_owner_delete', t);
  end loop;
end $$;

grant select, insert, update, delete on public.onboarding_drafts to fantasy_lpf_app;
create policy drafts_owner_select on public.onboarding_drafts for select to fantasy_lpf_app using (user_id = public.app_user_id());
create policy drafts_owner_insert on public.onboarding_drafts for insert to fantasy_lpf_app with check (user_id = public.app_user_id());
create policy drafts_owner_update on public.onboarding_drafts for update to fantasy_lpf_app using (user_id = public.app_user_id()) with check (user_id = public.app_user_id());
create policy drafts_owner_delete on public.onboarding_drafts for delete to fantasy_lpf_app using (user_id = public.app_user_id());

grant select, insert on public.transfers, public.transfer_items to fantasy_lpf_app;
create policy transfers_owner_select on public.transfers for select to fantasy_lpf_app
  using (exists (select 1 from public.fantasy_teams ft where ft.id = fantasy_team_id and ft.user_id = public.app_user_id()));
create policy transfers_owner_insert on public.transfers for insert to fantasy_lpf_app
  with check (exists (select 1 from public.fantasy_teams ft where ft.id = fantasy_team_id and ft.user_id = public.app_user_id()));
create policy transfer_items_owner_select on public.transfer_items for select to fantasy_lpf_app
  using (exists (select 1 from public.transfers t where t.id = transfer_id));
create policy transfer_items_owner_insert on public.transfer_items for insert to fantasy_lpf_app
  with check (exists (select 1 from public.transfers t where t.id = transfer_id));

grant select on public.team_gameweek_scores to fantasy_lpf_app;
create policy team_scores_owner_select on public.team_gameweek_scores for select to fantasy_lpf_app
  using (exists (select 1 from public.fantasy_teams ft where ft.id = fantasy_team_id and ft.user_id = public.app_user_id()));

-- The private league base tables remain owner-scoped. Narrow SECURITY DEFINER
-- functions below expose only the shared product data to league members.
create function public.app_is_league_member(p_league_id text) returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$ select public.app_user_id() is not null and exists (
  select 1 from public.league_memberships lm join public.fantasy_teams ft on ft.id = lm.fantasy_team_id
  where lm.league_id = p_league_id and ft.user_id = public.app_user_id()
) $$;
revoke all on function public.app_is_league_member(text) from public, anon, authenticated;
grant execute on function public.app_is_league_member(text) to fantasy_lpf_app;

grant select, insert, update, delete on public.leagues to fantasy_lpf_app;
create policy leagues_member_select on public.leagues for select to fantasy_lpf_app
  using (owner_user_id = public.app_user_id() or public.app_is_league_member(id));
create policy leagues_owner_insert on public.leagues for insert to fantasy_lpf_app
  with check (owner_user_id = public.app_user_id());
create policy leagues_owner_update on public.leagues for update to fantasy_lpf_app
  using (owner_user_id = public.app_user_id())
  with check (public.app_is_league_member(id) and public.app_is_league_member(id));
create policy leagues_owner_delete on public.leagues for delete to fantasy_lpf_app
  using (owner_user_id = public.app_user_id());

grant select, insert, delete on public.league_memberships to fantasy_lpf_app;
create policy memberships_self_select on public.league_memberships for select to fantasy_lpf_app
  using (exists (select 1 from public.fantasy_teams ft where ft.id = fantasy_team_id and ft.user_id = public.app_user_id()));
create policy memberships_owner_create on public.league_memberships for insert to fantasy_lpf_app
  with check (exists (select 1 from public.fantasy_teams ft join public.leagues l on l.id = league_id
    where ft.id = fantasy_team_id and ft.user_id = public.app_user_id() and l.owner_user_id = public.app_user_id()));
create policy memberships_self_delete on public.league_memberships for delete to fantasy_lpf_app
  using (exists (select 1 from public.fantasy_teams ft where ft.id = fantasy_team_id and ft.user_id = public.app_user_id()));

create function public.app_league_by_code(p_code text)
returns table(id text, tournament_id text, owner_user_id text, name text, code citext, created_at timestamptz)
language sql stable security definer set search_path = pg_catalog, public
as $$ select l.id, l.tournament_id, l.owner_user_id, l.name, l.code, l.created_at
  from public.leagues l where public.app_user_id() is not null and l.code = p_code limit 1 $$;
revoke all on function public.app_league_by_code(text) from public, anon, authenticated;
grant execute on function public.app_league_by_code(text) to fantasy_lpf_app;

create function public.app_league_code_exists(p_code text) returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$ select exists (select 1 from public.leagues where code = p_code) $$;
revoke all on function public.app_league_code_exists(text) from public, anon, authenticated;
grant execute on function public.app_league_code_exists(text) to fantasy_lpf_app;

create function public.app_join_league(p_code text, p_team_id text) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare target public.leagues%rowtype;
begin
  select * into target from public.leagues where code = p_code;
  if not found or public.app_user_id() is null then return false; end if;
  if not exists (select 1 from public.fantasy_teams where id = p_team_id
      and user_id = public.app_user_id() and tournament_id = target.tournament_id) then
    return false;
  end if;
  insert into public.league_memberships(league_id, fantasy_team_id, joined_at)
    values(target.id, p_team_id, now());
  return true;
end $$;
revoke all on function public.app_join_league(text,text) from public, anon, authenticated;
grant execute on function public.app_join_league(text,text) to fantasy_lpf_app;

create function public.app_leave_league(p_league_id text, p_team_id text) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare old_owner text; successor text;
begin
  if not exists (select 1 from public.fantasy_teams where id = p_team_id and user_id = public.app_user_id()) then return false; end if;
  select owner_user_id into old_owner from public.leagues where id = p_league_id;
  if not found then return false; end if;
  delete from public.league_memberships where league_id = p_league_id and fantasy_team_id = p_team_id;
  if not found then return false; end if;
  select ft.user_id into successor from public.league_memberships lm
    join public.fantasy_teams ft on ft.id = lm.fantasy_team_id
    where lm.league_id = p_league_id order by lm.joined_at limit 1;
  if successor is null then delete from public.leagues where id = p_league_id;
  elsif old_owner = public.app_user_id() then update public.leagues set owner_user_id = successor where id = p_league_id;
  end if;
  return true;
end $$;
revoke all on function public.app_leave_league(text,text) from public, anon, authenticated;
grant execute on function public.app_leave_league(text,text) to fantasy_lpf_app;

create function public.app_leagues_for_user(p_tournament_id text)
returns table(id text, name text, code citext, "tournamentId" text, "ownerUserId" text,
  "ownerManagerName" text, "createdAt" timestamptz, "memberCount" bigint)
language sql stable security definer set search_path = pg_catalog, public as $$
  select l.id,l.name,l.code,l.tournament_id,l.owner_user_id,p.manager_name,l.created_at,count(*)
  from public.leagues l join public.league_memberships lm on lm.league_id=l.id
  join public.fantasy_teams ft on ft.id=lm.fantasy_team_id
  join public.profiles p on p.user_id=l.owner_user_id
  where l.tournament_id=p_tournament_id and public.app_is_league_member(l.id)
  group by l.id,p.manager_name order by l.created_at desc
$$;
revoke all on function public.app_leagues_for_user(text) from public, anon, authenticated;
grant execute on function public.app_leagues_for_user(text) to fantasy_lpf_app;

create function public.app_league_leaderboard(p_league_id text, p_gameweek_id text)
returns table("fantasyTeamId" text,"teamName" text,"managerName" text,
  "totalPoints" integer,"gameweekPoints" integer,"bankCents" bigint,
  "joinedAt" timestamptz,"isCurrentUser" boolean,formation text,
  starters jsonb,bench jsonb,"captainId" text,"viceCaptainId" text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select ft.id,ft.name,p.manager_name,ft.total_points,ft.gameweek_points,ft.bank_cents,
    lm.joined_at,ft.user_id=public.app_user_id(),coalesce(ln.formation,ft.formation),
    coalesce((select jsonb_agg(lp.player_id order by lp.slot) from public.lineup_players lp
      where lp.fantasy_team_id=ft.id and lp.gameweek_id=ln.gameweek_id and lp.role='STARTER'),'[]'::jsonb),
    coalesce((select jsonb_agg(lp.player_id order by lp.slot) from public.lineup_players lp
      where lp.fantasy_team_id=ft.id and lp.gameweek_id=ln.gameweek_id and lp.role='BENCH'),'[]'::jsonb),
    coalesce(ln.captain_player_id,''),coalesce(ln.vice_captain_player_id,'')
  from public.league_memberships lm join public.fantasy_teams ft on ft.id=lm.fantasy_team_id
  join public.profiles p on p.user_id=ft.user_id
  left join lateral (select * from public.lineups l where l.fantasy_team_id=ft.id
    order by (l.gameweek_id=p_gameweek_id) desc,l.submitted_at desc limit 1) ln on true
  where lm.league_id=p_league_id and public.app_is_league_member(p_league_id)
  order by ft.total_points desc,ft.gameweek_points desc,lm.joined_at asc
$$;
revoke all on function public.app_league_leaderboard(text,text) from public, anon, authenticated;
grant execute on function public.app_league_leaderboard(text,text) to fantasy_lpf_app;

create function public.app_catalog_source_runs()
returns table(source text,status text,"finishedAt" timestamptz)
language sql stable security definer set search_path = pg_catalog, public as $$
  select sr.source,sr.status,sr.finished_at from public.sync_runs sr
  join (select source,max(finished_at) finished_at from public.sync_runs
    where source <> 'ALL' group by source) latest
    on latest.source=sr.source and latest.finished_at=sr.finished_at
$$;
revoke all on function public.app_catalog_source_runs() from public, anon, authenticated;
grant execute on function public.app_catalog_source_runs() to fantasy_lpf_app;

-- Supabase's exposed roles must not reach migration state, directly or through PUBLIC.
revoke all on public.app_schema_migrations from public, anon, authenticated, fantasy_lpf_app;
alter table public.app_schema_migrations enable row level security;

-- The role is not a table owner. FORCE is unnecessary for it; the privileged
-- internal postgres role must continue to run ingestion, scoring and migrations.
