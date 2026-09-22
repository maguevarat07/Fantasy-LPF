-- Additive checkpoint for bounded scoring work. Existing Vercel Cron runs still
-- process every finished gameweek when no batch limit is supplied.
alter table pipeline_runs add column if not exists score_cursor integer not null default 0;
alter table pipeline_runs add constraint pipeline_runs_score_cursor_nonnegative check (score_cursor >= 0);
