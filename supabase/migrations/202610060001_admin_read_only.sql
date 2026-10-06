-- Administrative access is a distinct, read-only PostgreSQL role. Never grant
-- membership to any role reachable by a browser or the normal application.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'fantasy_lpf_admin_reader') then
    create role fantasy_lpf_admin_reader nologin noinherit nobypassrls;
  end if;
  if pg_has_role('fantasy_lpf_app', 'fantasy_lpf_admin_reader', 'MEMBER')
     or pg_has_role('anon', 'fantasy_lpf_admin_reader', 'MEMBER')
     or pg_has_role('authenticated', 'fantasy_lpf_admin_reader', 'MEMBER') then
    raise exception 'A normal application role can inherit the administrative reader';
  end if;
end $$;
grant fantasy_lpf_admin_reader to postgres;
grant usage on schema public to fantasy_lpf_admin_reader;

create table admin_user_roles (
  user_id text primary key references users(id) on delete cascade,
  role text not null check (role in ('ADMIN','SUPPORT','DATA_ADMIN','SUPER_ADMIN')),
  granted_by text,
  granted_at timestamptz not null default now()
);
create table admin_mfa_credentials (
  user_id text primary key references users(id) on delete cascade,
  secret_ciphertext text not null,
  confirmed_at timestamptz,
  last_used_step bigint,
  created_at timestamptz not null default now()
);
create table admin_sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  parent_session_id text not null references sessions(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  expires_at timestamptz not null
);
create index admin_sessions_user_idx on admin_sessions(user_id);
create table admin_audit_log (
  id text primary key,
  admin_user_id text references users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  result text not null,
  request_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_log_recent_idx on admin_audit_log(created_at desc);
create table admin_rate_limits (
  bucket text primary key,
  attempts integer not null,
  reset_at timestamptz not null
);

create function public.audit_admin_role_change() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare subject_id text; operation text; old_role text; new_role text;
begin
  if tg_op = 'INSERT' then
    subject_id := new.user_id; new_role := new.role;
  elsif tg_op = 'DELETE' then
    subject_id := old.user_id; old_role := old.role;
  else
    subject_id := new.user_id; old_role := old.role; new_role := new.role;
  end if;
  operation := case tg_op when 'INSERT' then 'ROLE_GRANTED'
    when 'DELETE' then 'ROLE_REVOKED' else 'ROLE_CHANGED' end;
  insert into public.admin_audit_log(id,admin_user_id,action,target_type,target_id,result,request_id,metadata)
  values (gen_random_uuid()::text, null, operation, 'USER', subject_id, 'SUCCESS', gen_random_uuid()::text,
    jsonb_build_object('oldRole',old_role,'newRole',new_role,
      'operator',nullif(current_setting('app.admin_operator',true),'')));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.audit_admin_role_change() from public, anon, authenticated, fantasy_lpf_app, fantasy_lpf_admin_reader;
create trigger admin_role_change_audit after insert or update or delete on admin_user_roles
for each row execute function public.audit_admin_role_change();

create function public.set_fantasy_admin_role(p_user_id text, p_role text, p_operator text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if session_user <> 'postgres' then raise exception 'Trusted database operator required'; end if;
  if p_role not in ('ADMIN','SUPPORT','DATA_ADMIN','SUPER_ADMIN')
     or nullif(trim(p_operator),'') is null then raise exception 'Invalid role assignment'; end if;
  perform set_config('app.admin_operator',p_operator,true);
  insert into public.admin_user_roles(user_id,role,granted_by)
    values(p_user_id,p_role,p_operator)
    on conflict(user_id) do update set role=excluded.role,granted_by=excluded.granted_by,granted_at=now();
end $$;
create function public.revoke_fantasy_admin_role(p_user_id text, p_operator text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if session_user <> 'postgres' or nullif(trim(p_operator),'') is null then
    raise exception 'Trusted database operator required'; end if;
  perform set_config('app.admin_operator',p_operator,true);
  delete from public.admin_user_roles where user_id=p_user_id;
  delete from public.admin_sessions where user_id=p_user_id;
end $$;
create function public.reset_fantasy_admin_mfa(p_user_id text, p_operator text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if session_user <> 'postgres' or nullif(trim(p_operator),'') is null then
    raise exception 'Trusted database operator required'; end if;
  delete from public.admin_sessions where user_id=p_user_id;
  delete from public.admin_mfa_credentials where user_id=p_user_id;
  insert into public.admin_audit_log(id,admin_user_id,action,target_type,target_id,result,request_id,metadata)
  values(gen_random_uuid()::text,null,'MFA_RESET','USER',p_user_id,'SUCCESS',gen_random_uuid()::text,
    jsonb_build_object('operator',p_operator));
end $$;
revoke all on function public.set_fantasy_admin_role(text,text,text),
  public.revoke_fantasy_admin_role(text,text),
  public.reset_fantasy_admin_mfa(text,text) from public, anon, authenticated,
  fantasy_lpf_app, fantasy_lpf_admin_reader;

do $$ declare t text; begin
  foreach t in array array['admin_user_roles','admin_mfa_credentials','admin_sessions','admin_audit_log','admin_rate_limits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, fantasy_lpf_app, fantasy_lpf_admin_reader', t);
  end loop;
end $$;

grant select(id,email,username,created_at) on users to fantasy_lpf_admin_reader;
grant select(user_id,manager_name,province,favorite_club_id) on profiles to fantasy_lpf_admin_reader;
grant select(user_id,last_seen_at) on sessions to fantasy_lpf_admin_reader;
grant select on fantasy_teams,squad_players,lineups,lineup_players,leagues,league_memberships,
  transfers,transfer_items,team_gameweek_scores,tournaments,gameweeks,clubs,players,tournament_players
  to fantasy_lpf_admin_reader;
grant select(id,stage,quality_status,started_at,finished_at,scoring_status,pricing_status,last_error)
  on pipeline_runs to fantasy_lpf_admin_reader;

do $$ declare t text; begin
  foreach t in array array['users','profiles','sessions','fantasy_teams','squad_players','lineups',
    'lineup_players','leagues','league_memberships','transfers','transfer_items',
    'team_gameweek_scores','tournaments','gameweeks','clubs','players','tournament_players','pipeline_runs'] loop
    execute format('create policy %I on public.%I for select to fantasy_lpf_admin_reader using (true)',
      t || '_admin_reader_select', t);
  end loop;
end $$;
