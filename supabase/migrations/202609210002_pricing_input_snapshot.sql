-- Legacy GW7/GW8 remain null; their inputs were not recorded at execution time.
-- New runs store the exact serialized engine input and bootstrap flag alongside
-- the existing input_hash. TEXT preserves JSON number serialization for replay.
alter table public.pricing_runs
  add column if not exists input_snapshot_json text;
