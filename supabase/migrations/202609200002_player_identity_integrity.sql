-- Auditable cross-source player identity decisions. A normalized name/club/position
-- match is only a review candidate; it is never sufficient to merge automatically.

alter table players add column if not exists merged_into_player_id text references players(id);
create index if not exists players_merged_into_idx on players(merged_into_player_id)
  where merged_into_player_id is not null;

create table player_identity_resolutions (
  source text not null,
  external_id text not null,
  canonical_player_id text not null references players(id),
  retired_player_id text references players(id),
  decision text not null check (decision in ('SAME_PERSON','DISTINCT_PERSON','UNRESOLVED','REVERSED')),
  evidence_url text,
  evidence_summary text not null,
  resolved_at timestamptz not null,
  resolved_by text not null,
  primary key (source, external_id)
);
create index player_identity_resolutions_canonical_idx
  on player_identity_resolutions(canonical_player_id);

create table player_identity_candidates (
  source text not null,
  external_id text not null,
  candidate_player_id text not null references players(id),
  normalized_name text not null,
  club_id text not null references clubs(id),
  position text not null,
  incoming_json jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  primary key (source, external_id, candidate_player_id)
);
create index player_identity_candidates_pending_idx
  on player_identity_candidates(status, last_seen_at desc);

create table player_identity_merge_audit (
  merge_id text primary key,
  canonical_player_id text not null references players(id),
  retired_player_id text not null references players(id),
  decision text not null check (decision in ('MERGED','REVERSED')),
  evidence_url text not null,
  evidence_summary text not null,
  snapshot_json jsonb not null,
  executed_at timestamptz not null,
  executed_by text not null,
  reversed_at timestamptz
);

alter table player_identity_resolutions enable row level security;
alter table player_identity_candidates enable row level security;
alter table player_identity_merge_audit enable row level security;
revoke all on player_identity_resolutions,player_identity_candidates,player_identity_merge_audit
  from public,anon,authenticated,fantasy_lpf_app;

do $$
declare
  item record;
  snapshot jsonb;
  merge_key text;
  unsafe_references integer;
begin
  for item in select * from (values
    ('3cc8d743-bd65-455a-aa5e-9dd65dd4360a','75d88c93-34d5-4d2b-bc46-38a29c0ca942','LPF','keny-bonilla',
      'https://lpf.com.pa/player/keny-bonilla/','LPF y Transfermarkt identifican a Keny Bonilla (02/04/2003), delantero de San Francisco.'),
    ('61623513-30f5-4b54-a939-006606374b5e','dd4e8c45-fc23-41a3-8530-3512042ec410','LPF','kevin-walder',
      'https://www.transfermarkt.es/kevin-walder/profil/spieler/1105072','LPF y Transfermarkt identifican al mismo Kevin Walder de Plaza Amador; la fecha LPF 11/03/2023 es una fecha de registro inválida como nacimiento.'),
    ('dc06377e-9349-4740-87e5-87f150471905','f6a1d3e9-4ce1-4c3c-87ce-9b530a930d23','LPF','matthews-moreno',
      'https://www.transfermarkt.es/herrera-fc/startseite/verein/55384','LPF y Transfermarkt identifican al mismo Matthews Moreno, dorsal 4 de Herrera.'),
    ('fa4fc833-3ae9-4705-9689-abd7981b4466','0b54c680-5c53-4e04-a679-704749f0998b','LPF','saed-diaz',
      'https://www.transfermarkt.es/saed-diaz/profil/spieler/629212','LPF y Transfermarkt coinciden en nombre, fecha 23/06/1999, posición y club de Saed Díaz.')
  ) as decisions(canonical_id,retired_id,source,external_id,evidence_url,evidence_summary)
  loop
    -- The migration is safe in fresh/QA schemas where these production IDs do not exist.
    if not exists (select 1 from players where id=item.canonical_id)
      or not exists (select 1 from players where id=item.retired_id) then
      continue;
    end if;
    perform pg_advisory_xact_lock(hashtext('player-identity:' || item.canonical_id));
    perform 1 from players where id in (item.canonical_id,item.retired_id) for update;

    select
      (select count(*) from squad_players where player_id=item.retired_id) +
      (select count(*) from lineup_players where player_id=item.retired_id) +
      (select count(*) from lineups where captain_player_id=item.retired_id or vice_captain_player_id=item.retired_id) +
      (select count(*) from transfer_items where player_in_id=item.retired_id or player_out_id=item.retired_id) +
      (select count(*) from player_match_stats where player_id=item.retired_id) +
      (select count(*) from player_fantasy_points where player_id=item.retired_id) +
      (select count(*) from player_price_history where player_id=item.retired_id)
    into unsafe_references;
    if unsafe_references <> 0 then
      raise exception 'Player merge % -> % requires manual collision review (% dependent rows)',
        item.retired_id,item.canonical_id,unsafe_references;
    end if;
    if exists (select 1 from player_external_ids where player_id=item.canonical_id and source=item.source) then
      raise exception 'Canonical player % already has source %',item.canonical_id,item.source;
    end if;

    select jsonb_build_object(
      'player',(select to_jsonb(p) from players p where p.id=item.retired_id),
      'tournamentPlayers',coalesce((select jsonb_agg(to_jsonb(x)) from tournament_players x where x.player_id=item.retired_id),'[]'::jsonb),
      'externalIds',coalesce((select jsonb_agg(to_jsonb(x)) from player_external_ids x where x.player_id=item.retired_id),'[]'::jsonb),
      'clubHistory',coalesce((select jsonb_agg(to_jsonb(x)) from player_club_history x where x.player_id=item.retired_id),'[]'::jsonb),
      'rosterRegistrations',coalesce((select jsonb_agg(to_jsonb(x)) from tournament_roster_registrations x where x.player_id=item.retired_id),'[]'::jsonb),
      'verifiedEmptyReferences',jsonb_build_object('squad',0,'lineups',0,'captainVice',0,'transfers',0,'stats',0,'points',0,'priceHistory',0)
    ) into snapshot;
    merge_key := md5(item.canonical_id || ':' || item.retired_id || ':202609200002');

    insert into player_identity_merge_audit(merge_id,canonical_player_id,retired_player_id,decision,
      evidence_url,evidence_summary,snapshot_json,executed_at,executed_by)
    values(merge_key,item.canonical_id,item.retired_id,'MERGED',item.evidence_url,item.evidence_summary,
      snapshot,now(),'migration:202609200002') on conflict(merge_id) do nothing;

    update player_external_ids set player_id=item.canonical_id where player_id=item.retired_id;
    update player_club_history set player_id=item.canonical_id where player_id=item.retired_id;
    update tournament_roster_registrations set player_id=item.canonical_id where player_id=item.retired_id;
    delete from tournament_players where player_id=item.retired_id;
    update players set active=false,status='INACTIVE',merged_into_player_id=item.canonical_id,updated_at=now()
      where id=item.retired_id;

    insert into player_identity_resolutions(source,external_id,canonical_player_id,retired_player_id,
      decision,evidence_url,evidence_summary,resolved_at,resolved_by)
    values(item.source,item.external_id,item.canonical_id,item.retired_id,'SAME_PERSON',item.evidence_url,
      item.evidence_summary,now(),'migration:202609200002')
    on conflict(source,external_id) do update set canonical_player_id=excluded.canonical_player_id,
      retired_player_id=excluded.retired_player_id,decision=excluded.decision,evidence_url=excluded.evidence_url,
      evidence_summary=excluded.evidence_summary,resolved_at=excluded.resolved_at,resolved_by=excluded.resolved_by;
  end loop;
end $$;
