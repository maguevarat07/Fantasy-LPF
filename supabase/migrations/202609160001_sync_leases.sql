create table if not exists sync_leases (
  name text primary key,
  owner text not null,
  acquired_at timestamptz not null,
  expires_at timestamptz not null
);

alter table sync_leases enable row level security;
revoke all on table sync_leases from anon, authenticated;

