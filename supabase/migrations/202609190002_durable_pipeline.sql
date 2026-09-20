create table pipeline_runs (
  id text primary key,
  ingestion_run_id text,
  stage text not null check (stage in ('CREATED','INGESTING','INGESTED','NORMALIZED','RECONCILED',
    'SCORING','SCORED','PRICING','PRICED','PARTIAL','FAILED')),
  quality_status text not null default 'PENDING' check (quality_status in ('PENDING','WORKING','PARTIAL','FAILED')),
  started_at timestamptz not null,
  updated_at timestamptz not null,
  finished_at timestamptz,
  attempts integer not null default 0,
  next_retry_at timestamptz,
  last_error text,
  records_fetched integer not null default 0,
  records_accepted integer not null default 0,
  conflicts_blocking integer not null default 0,
  conflicts_non_blocking integer not null default 0,
  scoring_status text not null default 'PENDING',
  pricing_status text not null default 'PENDING',
  source_summary_json jsonb not null default '{}'::jsonb,
  stage_durations_json jsonb not null default '{}'::jsonb,
  duration_ms bigint,
  check (attempts >= 0)
);
create unique index pipeline_runs_one_active_idx on pipeline_runs ((true))
  where stage not in ('PRICED','PARTIAL','FAILED');
create index pipeline_runs_latest_idx on pipeline_runs(started_at desc);

create table pipeline_conflicts (
  run_id text not null references pipeline_runs(id) on delete cascade,
  severity text not null check (severity in ('BLOCKING','NON_BLOCKING')),
  kind text not null,
  conflict_key text not null,
  reason text not null,
  sources_json jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING','RESOLVED')),
  created_at timestamptz not null,
  primary key (run_id, kind, conflict_key)
);
create index pipeline_conflicts_pending_idx on pipeline_conflicts(severity,status,created_at desc);

create table pipeline_gameweek_status (
  gameweek_id text primary key references gameweeks(id) on delete cascade,
  scoring_status text not null default 'PENDING',
  pricing_status text not null default 'PENDING',
  scored_at timestamptz,
  priced_at timestamptz,
  last_run_id text references pipeline_runs(id) on delete set null,
  updated_at timestamptz not null
);

alter table pipeline_runs enable row level security;
alter table pipeline_conflicts enable row level security;
alter table pipeline_gameweek_status enable row level security;
revoke all on pipeline_runs,pipeline_conflicts,pipeline_gameweek_status from public,anon,authenticated,fantasy_lpf_app;

-- Only sanitized operational state is exposed to the public catalog.
create function public.app_pipeline_status() returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'latestRun', (select jsonb_build_object('id',r.id,'stage',r.stage,'qualityStatus',r.quality_status,
      'startedAt',r.started_at,'finishedAt',r.finished_at,'recordsFetched',r.records_fetched,
      'recordsAccepted',r.records_accepted,'conflictsBlocking',r.conflicts_blocking,
      'conflictsNonBlocking',r.conflicts_non_blocking,'scoringStatus',r.scoring_status,
      'pricingStatus',r.pricing_status,'durationMs',r.duration_ms)
      from public.pipeline_runs r order by r.started_at desc limit 1),
    'overdueGameweeks', coalesce((select jsonb_agg(jsonb_build_object('id',gw.id,'name',gw.name,
      'scoringStatus',coalesce(gs.scoring_status,'PENDING'),
      'pricingStatus',coalesce(gs.pricing_status,'PENDING')) order by gw.week_number)
      from public.gameweeks gw left join public.pipeline_gameweek_status gs on gs.gameweek_id=gw.id
      where gw.status='FINISHED'
        and coalesce(gw.ends_at,(select max(m.starts_at) + interval '3 hours' from public.matches m
          where m.gameweek_id=gw.id),gw.deadline_at + interval '3 days') + interval '3 hours' < now()
        and (coalesce(gs.scoring_status,'PENDING') <> 'SCORED'
          or coalesce(gs.pricing_status,'PENDING') <> 'PRICED')),'[]'::jsonb)
  )
$$;
revoke all on function public.app_pipeline_status() from public,anon,authenticated;
grant execute on function public.app_pipeline_status() to fantasy_lpf_app;
