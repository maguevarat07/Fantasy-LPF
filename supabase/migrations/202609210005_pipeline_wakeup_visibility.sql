-- pgmq.send uses a wall-clock visibility timestamp. In the same transaction,
-- now() remains pinned to transaction start and can precede the new message.
-- Use wall-clock time so a freshly enqueued message gets its first wake-up.
create or replace function public.dispatch_and_wake_fantasy_pipeline() returns bigint
language plpgsql security definer
set search_path = pg_catalog, public, pgmq, vault, net as $$
declare
  pending_message bigint;
  request_id bigint;
  worker_secret text;
begin
  perform public.dispatch_fantasy_pipeline_message();
  select q.msg_id into pending_message from pgmq.q_fantasy_pipeline q
    where q.vt <= clock_timestamp() order by q.msg_id limit 1;
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
