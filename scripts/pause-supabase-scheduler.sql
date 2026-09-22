-- Immediate database-side rollback. Preserve queue messages, run and cursors.
do $$
begin
  if exists(select 1 from cron.job where jobname='fantasy_pipeline_dispatch') then
    perform cron.unschedule('fantasy_pipeline_dispatch');
  end if;
  if exists(select 1 from cron.job where jobname='fantasy_pipeline_archive_prune') then
    perform cron.unschedule('fantasy_pipeline_archive_prune');
  end if;
end
$$;
