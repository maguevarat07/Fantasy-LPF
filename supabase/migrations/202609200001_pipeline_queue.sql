-- Preparación durable únicamente. Esta migración NO registra ni activa Cron.
create extension if not exists pgmq;

do $$
begin
  if not exists (select 1 from pgmq.list_queues() where queue_name = 'fantasy_pipeline') then
    perform pgmq.create('fantasy_pipeline');
  end if;
end
$$;

revoke all on schema pgmq from anon, authenticated, fantasy_lpf_app;

create function public.dispatch_fantasy_pipeline_message() returns bigint
language plpgsql security definer
set search_path = pg_catalog, public, pgmq as $$
declare
  selected_run public.pipeline_runs%rowtype;
  selected_stage text;
  selected_cursor jsonb;
  selected_week text;
  delay_seconds integer;
  message_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('fantasy-pipeline-queue-dispatch'));
  -- Invisible messages are still present, so no second wake-up is sent while
  -- one worker owns a message or waits for its visibility timeout.
  if exists (select 1 from pgmq.q_fantasy_pipeline) then return null; end if;

  select * into selected_run from public.pipeline_runs
    where stage not in ('PRICED','PARTIAL','FAILED') order by started_at limit 1;
  if not found then
    if exists (select 1 from public.pipeline_runs
      where stage in ('PRICED','PARTIAL') and finished_at > now() - interval '20 hours') then
      return null;
    end if;
    insert into public.pipeline_runs(id,stage,started_at,updated_at)
      values(gen_random_uuid()::text,'CREATED',now(),now()) returning * into selected_run;
  end if;

  selected_stage := case
    when selected_run.stage in ('CREATED','INGESTING') then 'INGEST'
    when selected_run.stage in ('INGESTED','NORMALIZED','PUBLISHING') then 'PUBLISH'
    when selected_run.stage in ('RECONCILED','SCORING') then 'SCORE'
    when selected_run.stage in ('SCORED','PRICING') then 'PRICE'
    else null end;
  if selected_stage is null then return null; end if;

  select jsonb_build_object('entity',entity_cursor,'observation',observation_cursor)
    into selected_cursor from public.pipeline_ingest_payloads where run_id=selected_run.id;
  select id into selected_week from public.gameweeks
    where tournament_id='apertura-2026' and status='FINISHED'
    order by week_number desc limit 1;
  delay_seconds := greatest(0,ceil(extract(epoch from(selected_run.next_retry_at-now())))::integer);
  select pgmq.send('fantasy_pipeline',jsonb_build_object(
    'runId',selected_run.id,'tournamentId','apertura-2026',
    'gameweekId',selected_week,'stage',selected_stage,
    'cursor',coalesce(selected_cursor,'{"entity":0,"observation":0}'::jsonb),
    'attempt',selected_run.attempts,'createdAt',now()),delay_seconds)
    into message_id;
  return message_id;
end
$$;

revoke all on function public.dispatch_fantasy_pipeline_message() from public, anon, authenticated, fantasy_lpf_app;
