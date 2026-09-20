alter table pipeline_runs drop constraint pipeline_runs_stage_check;
alter table pipeline_runs add constraint pipeline_runs_stage_check check (stage in
  ('CREATED','INGESTING','INGESTED','NORMALIZED','PUBLISHING','RECONCILED',
   'SCORING','SCORED','PRICING','PRICED','PARTIAL','FAILED'));

create table pipeline_ingest_payloads (
  run_id text primary key references pipeline_runs(id) on delete cascade,
  report_json jsonb not null,
  entity_cursor integer not null default 0,
  observation_cursor integer not null default 0,
  records_created integer not null default 0,
  records_updated integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (entity_cursor >= 0 and observation_cursor >= 0)
);
alter table pipeline_ingest_payloads enable row level security;
revoke all on pipeline_ingest_payloads from public,anon,authenticated,fantasy_lpf_app;

-- Resume an interrupted run from the previous all-in-one implementation by
-- fetching again. Its transaction rolled back, so no payload/cursor exists.
update pipeline_runs set stage='CREATED',attempts=0,next_retry_at=null,updated_at=now()
where stage in ('INGESTING','INGESTED','NORMALIZED')
  and not exists(select 1 from pipeline_ingest_payloads p where p.run_id=pipeline_runs.id);
