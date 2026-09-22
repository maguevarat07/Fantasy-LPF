-- Apply only after the controlled production worker test and after the Vercel
-- deployment without crons is READY. The worker flag and Vault secret must be on.
select cron.schedule('fantasy_pipeline_dispatch', '* * * * *',
  'select public.dispatch_and_wake_fantasy_pipeline()');
select cron.schedule('fantasy_pipeline_archive_prune', '0 3 * * 0',
  'select public.prune_fantasy_pipeline_archive()');
