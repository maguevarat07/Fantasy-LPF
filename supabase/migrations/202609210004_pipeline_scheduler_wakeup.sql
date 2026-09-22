-- The cron job is intentionally installed separately after the worker secret and
-- disabled deployment have been verified. This migration only prepares a wake-up.
create extension if not exists pg_net with schema extensions;

create table if not exists pipeline_worker_wakeups (
  id bigint generated always as identity primary key,
  message_id bigint not null,
  request_id bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists pipeline_worker_wakeups_created_idx
  on pipeline_worker_wakeups(created_at desc);
alter table pipeline_worker_wakeups enable row level security;
revoke all on pipeline_worker_wakeups from public, anon, authenticated, fantasy_lpf_app;

create or replace function public.dispatch_and_wake_fantasy_pipeline() returns bigint
language plpgsql security definer
set search_path = pg_catalog, public, pgmq, vault, net as $$
declare
  pending_message bigint;
  request_id bigint;
  worker_secret text;
begin
  -- The dispatcher serializes run creation. A visible existing message also
  -- needs a wake-up, for example after a worker crash or visibility timeout.
  perform public.dispatch_fantasy_pipeline_message();
  select q.msg_id into pending_message from pgmq.q_fantasy_pipeline q
    where q.vt <= now() order by q.msg_id limit 1;
  if pending_message is null then return null; end if;

  select decrypted_secret into worker_secret from vault.decrypted_secrets
    where name = 'fantasy_pipeline_worker_secret';
  if worker_secret is null or length(worker_secret) < 32 then
    raise exception 'Missing dedicated fantasy pipeline worker secret in Vault';
  end if;

  select net.http_post(
    url := 'https://fantasy-lpf.vercel.app/api/automation/worker',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer ' || worker_secret),
    body := jsonb_build_object('messageId',pending_message),
    timeout_milliseconds := 10000
  ) into request_id;
  insert into public.pipeline_worker_wakeups(message_id,request_id)
    values(pending_message,request_id);
  return request_id;
end
$$;
revoke all on function public.dispatch_and_wake_fantasy_pipeline()
  from public, anon, authenticated, fantasy_lpf_app;

create or replace function public.prune_fantasy_pipeline_archive() returns integer
language plpgsql security definer
set search_path = pg_catalog, public, pgmq as $$
declare
  removed integer;
begin
  delete from pgmq.a_fantasy_pipeline where archived_at < now() - interval '30 days';
  get diagnostics removed = row_count;
  return removed;
end
$$;
revoke all on function public.prune_fantasy_pipeline_archive()
  from public, anon, authenticated, fantasy_lpf_app;
