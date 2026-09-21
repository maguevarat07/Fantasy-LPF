-- Evidence-backed identity and canonical-field decisions from the 2026 LPF audit.
-- The operation keeps tombstones and a full snapshot, and refuses any merge whose
-- retired branch unexpectedly acquired Fantasy data after the audit.

create table if not exists player_field_resolutions (
  player_id text not null references players(id),
  field_name text not null check (field_name in ('position','club_id','tournament_active')),
  canonical_value text not null,
  evidence_urls jsonb not null default '[]'::jsonb,
  evidence_summary text not null,
  resolved_at timestamptz not null,
  resolved_by text not null,
  primary key (player_id,field_name)
);
alter table player_field_resolutions enable row level security;
revoke all on player_field_resolutions from public,anon,authenticated,fantasy_lpf_app;

do $$
declare
  item record;
  snapshot jsonb;
  unsafe_references integer;
  merge_key text;
begin
  for item in select * from (values
    ('6b220912-fe76-4fe1-93db-53d3a8e42428','2ac407c0-1724-4506-89b7-26735c4877e9','LPF','abdiel-castro','https://www.transfermarkt.es/abdiel-castro/profil/spieler/866320','Misma identidad (DOB 21/06/2002 y Herrera); el perfil actual identifica al jugador como mediocampista/interior izquierdo.'),
    ('08441a14-bbf0-47fc-83df-df5fed24b8cd','ea929c65-b6f8-4812-a8aa-40b8800b3bc4','LPF','gustavo-herrera','https://www.transfermarkt.com.ar/gustavo-herrera/profil/spieler/1198808','Gustavo Eloy Herrera Prescott, dorsal 99 de Sporting, es delantero centro; el registro MID es un duplicado histórico.'),
    ('d54275e9-1148-43a0-90e7-526774c9c160','7544e3c5-5271-4534-b315-d0093331caa2','LPF','jose-murillo','https://www.transfermarkt.es/jose-murillo/profil/spieler/433646','Misma identidad (DOB 24/02/1995, Plaza Amador, dorsal 20); posición canónica mediocampista/pivote.'),
    ('623c0754-3edb-4359-9708-ba03d0e0f195','22333602-307a-49b7-b301-419842b514a1','LPF','leonel-triana','https://www.soccerway.com/player/triana-leonel/pdaMMHw7/','Misma identidad (DOB 13/09/1995 y Herrera); posición canónica mediocampista.'),
    ('de5f700a-b68e-4123-85ac-59ee8358fd7d','0527ca97-a03f-4903-8f83-65f96031ad1a','LPF','luis-zuniga','https://www.transfermarkt.es/luis-zuniga/profil/spieler/295606','Misma identidad (DOB 27/01/1997 y Sporting); posición canónica delantero/extremo derecho.'),
    ('afda1cbd-ab31-46b5-adc5-3089245a2a0d','6e66c780-c707-4e89-9539-95b9c28bb5ec','LPF','abdiel-jimenez','https://www.transfermarkt.es/abdiel-jimenez/profil/spieler/1242728','Misma identidad: defensa central trasladado de Herrera a Árabe Unido en 2025; el perfil LPF es histórico.'),
    ('c21512d9-08a0-4532-8f18-48527fe2965d','d3786459-a35d-4689-aa80-4656a845d1dc','LPF','alexis-cedeno-2','https://www.concacaf.com/media/gfsnvmhn/26_ccc_club-rosters.pdf','Misma identidad: Alexis Antonio Cedeño Hackett, defensa de Sporting, transferido fuera de LPF en julio de 2026.'),
    ('61bc8366-f555-48b1-93b8-3210726807ca','6e3ad6a9-fbd5-4888-993e-56f18512a477','LPF','francisco-bethancourt','https://lpf.com.pa/ta-2023-plantilla-herrera-fc/','Misma identidad; el perfil San Francisco es histórico y el club vigente en la fuente de temporada es Herrera.'),
    ('9a1f527d-d5fc-4288-ac27-d0e12f9f3f76','b3d68761-845c-4594-a480-08d121a1915a','LPF','javier-gondola','https://www.sofascore.com/es-la/football/team/cocle-fc/379178','Misma identidad; el perfil Universitario es histórico y fuentes 2026 lo ubican en Unión Coclé.'),
    ('ddfb1d11-4802-4f0f-9449-2c9643b976aa','c2e4ab7d-db27-4e54-a5e1-9bef17db2d08','LPF','ricardo-avila','https://www.transfermarkt.es/ricardo-avila/profil/spieler/440384','Misma identidad; Universitario y UMECIT son etapas históricas y figura sin club desde 01/01/2026.')
  ) as decisions(canonical_id,retired_id,source,external_id,evidence_url,evidence_summary)
  loop
    if not exists(select 1 from players where id=item.canonical_id)
      or not exists(select 1 from players where id=item.retired_id) then continue; end if;
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
    select jsonb_build_object(
      'player',(select to_jsonb(p) from players p where p.id=item.retired_id),
      'tournamentPlayers',coalesce((select jsonb_agg(to_jsonb(x)) from tournament_players x where x.player_id=item.retired_id),'[]'::jsonb),
      'externalIds',coalesce((select jsonb_agg(to_jsonb(x)) from player_external_ids x where x.player_id=item.retired_id),'[]'::jsonb),
      'clubHistory',coalesce((select jsonb_agg(to_jsonb(x)) from player_club_history x where x.player_id=item.retired_id),'[]'::jsonb),
      'rosterRegistrations',coalesce((select jsonb_agg(to_jsonb(x)) from tournament_roster_registrations x where x.player_id=item.retired_id),'[]'::jsonb),
      'verifiedEmptyReferences',jsonb_build_object('squad',0,'lineups',0,'captainVice',0,'transfers',0,'stats',0,'points',0,'priceHistory',0)
    ) into snapshot;
    merge_key := md5(item.canonical_id || ':' || item.retired_id || ':202609210001');
    insert into player_identity_merge_audit(merge_id,canonical_player_id,retired_player_id,decision,evidence_url,
      evidence_summary,snapshot_json,executed_at,executed_by)
    values(merge_key,item.canonical_id,item.retired_id,'MERGED',item.evidence_url,item.evidence_summary,snapshot,now(),
      'migration:202609210001') on conflict(merge_id) do nothing;
    -- A source can expose more than one historical slug for the same human,
    -- while the legacy schema allows one external ID per player/source. Keep
    -- the retired alias attached to its tombstone in that case; the explicit
    -- resolution redirects ingestion to the canonical player.
    if not exists(select 1 from player_external_ids where player_id=item.canonical_id and source=item.source) then
      update player_external_ids set player_id=item.canonical_id where player_id=item.retired_id;
    end if;
    update player_club_history set player_id=item.canonical_id where player_id=item.retired_id;
    update tournament_roster_registrations set player_id=item.canonical_id where player_id=item.retired_id;
    delete from tournament_players where player_id=item.retired_id;
    update players set active=false,status='INACTIVE',merged_into_player_id=item.canonical_id,updated_at=now()
      where id=item.retired_id;
    insert into player_identity_resolutions(source,external_id,canonical_player_id,retired_player_id,decision,
      evidence_url,evidence_summary,resolved_at,resolved_by)
    values(item.source,item.external_id,item.canonical_id,item.retired_id,'SAME_PERSON',item.evidence_url,
      item.evidence_summary,now(),'migration:202609210001')
    on conflict(source,external_id) do update set canonical_player_id=excluded.canonical_player_id,
      retired_player_id=excluded.retired_player_id,decision=excluded.decision,evidence_url=excluded.evidence_url,
      evidence_summary=excluded.evidence_summary,resolved_at=excluded.resolved_at,resolved_by=excluded.resolved_by;
  end loop;
end $$;

insert into player_field_resolutions(player_id,field_name,canonical_value,evidence_urls,evidence_summary,resolved_at,resolved_by)
select v.player_id,v.field_name,v.canonical_value,v.evidence_urls::jsonb,v.evidence_summary,now(),'migration:202609210001'
from (values
('6b220912-fe76-4fe1-93db-53d3a8e42428','position','MID','["https://www.transfermarkt.es/abdiel-castro/profil/spieler/866320","https://www.sofascore.com/football/player/abdiel-castro/2680703"]','Mediocampista/interior izquierdo; DOB, club y dorsal corroboran identidad.'),
('c21512d9-08a0-4532-8f18-48527fe2965d','club_id',(select id from clubs where normalized_name='sporting'),'["https://www.concacaf.com/media/gfsnvmhn/26_ccc_club-rosters.pdf","https://www.ubconquense.es/actualidad/la-ub-conquense-incorpora-talento-internacional-con-la-llegada-de-alexis-cedeno"]','Sporting fue su club LPF 2026; salió a UB Conquense en julio.'),
('c21512d9-08a0-4532-8f18-48527fe2965d','tournament_active','false','["https://www.ubconquense.es/actualidad/la-ub-conquense-incorpora-talento-internacional-con-la-llegada-de-alexis-cedeno"]','Fuera de LPF desde julio de 2026; se preserva ownership histórico y se bloquean nuevas compras.'),
('ddfb1d11-4802-4f0f-9449-2c9643b976aa','tournament_active','false','["https://www.transfermarkt.es/ricardo-avila/profil/spieler/440384"]','Sin club desde 01/01/2026; se preserva ownership histórico y se bloquean nuevas compras.')
) as v(player_id,field_name,canonical_value,evidence_urls,evidence_summary)
where v.canonical_value is not null and exists(select 1 from players p where p.id=v.player_id)
on conflict(player_id,field_name) do update set canonical_value=excluded.canonical_value,evidence_urls=excluded.evidence_urls,
  evidence_summary=excluded.evidence_summary,resolved_at=excluded.resolved_at,resolved_by=excluded.resolved_by;

update players set position='MID',updated_at=now() where id='6b220912-fe76-4fe1-93db-53d3a8e42428';
update players set club_id=(select id from clubs where normalized_name='sporting'),updated_at=now()
  where id='c21512d9-08a0-4532-8f18-48527fe2965d';
update tournament_players set active=false where tournament_id='apertura-2026'
  and player_id in ('c21512d9-08a0-4532-8f18-48527fe2965d','ddfb1d11-4802-4f0f-9449-2c9643b976aa');

update pipeline_conflicts set status='RESOLVED' where kind='PLAYER_IDENTITY' and conflict_key in (
  'player|LPF|abdiel-castro|player|TRANSFERMARKT|866320',
  'player|LPF|abdiel-jimenez|player|TRANSFERMARKT|1242728',
  'player|LPF|alexis-cedeno-2|player|TRANSFERMARKT|1157418',
  'player|LPF|daniel-vargas|player|TRANSFERMARKT|866262',
  'player|LPF|francisco-bethancourt|player|TRANSFERMARKT|385993',
  'player|LPF|gustavo-herrera|player|LPF|gustavo-herrera-2',
  'player|LPF|jamal-garces|player|TRANSFERMARKT|1158322',
  'player|LPF|javier-gondola|player|TRANSFERMARKT|866396',
  'player|LPF|jose-murillo|player|TRANSFERMARKT|433646',
  'player|LPF|leonel-triana|player|TRANSFERMARKT|866322',
  'player|LPF|luis-zuniga|player|TRANSFERMARKT|295606',
  'player|LPF|ricardo-avila|player|TRANSFERMARKT|440384',
  'player|LPF|rolando-batista|player|TRANSFERMARKT|1213433'
);
