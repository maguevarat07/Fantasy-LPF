import { createHash, randomUUID } from 'node:crypto';
import { calculatePlayerPoints, SCORING_VERSION } from '../scoring.js';
import {
  calculatePriceQuotes, pricingConfigFromEnv,
  type PlayerPricingInput, type PricingEngineInput, type PricingPosition, type PricingRunResult,
} from '../pricingEngine.js';
import type { PostgresDatabase, PostgresExecutor } from './client.js';

type Row = Record<string, unknown>;
const timestamp = () => new Date().toISOString();

export async function recalculateGameweekPostgres(
  db: PostgresDatabase,
  gameweekId: string,
): Promise<{ players: number; teams: number }> {
  const rows = await db.query<Row>(`select s.*,p.position,p.club_id as player_club_id,
    m.home_club_id,m.away_club_id,m.home_score,m.away_score
    from player_match_stats s join players p on p.id=s.player_id join matches m on m.id=s.match_id
    where m.gameweek_id=$1 and m.score_status in ('CONFIRMED','CORRECTED')`, [gameweekId]);
  const at = timestamp();
  const teamCount = await db.transaction(async tx => {
    for (const row of rows) {
      const clubId = String(row.club_id ?? row.player_club_id ?? '');
      const opponentScore = clubId === row.home_club_id ? row.away_score : clubId === row.away_club_id ? row.home_score : null;
      const participated = Boolean(row.starter) || Boolean(row.substitute_in);
      const input = {
        position: String(row.position), started: Boolean(row.starter), substituteIn: Boolean(row.substitute_in),
        goals: Number(row.goals ?? 0),
        confirmedAssists: row.assist_status === 'CONFIRMED' || row.assist_status === 'CORRECTED' ? Number(row.assists ?? 0) : 0,
        yellowCards: Number(row.yellow_cards ?? 0), redCards: Number(row.red_cards ?? 0),
        ownGoals: Number(row.own_goals ?? 0), cleanSheet: opponentScore === 0 && participated,
      };
      const points = calculatePlayerPoints(input);
      const hash = createHash('sha256').update(JSON.stringify({ row, input, version: SCORING_VERSION })).digest('hex');
      await tx.execute(`insert into player_fantasy_points(player_id,match_id,gameweek_id,participation_points,
        goal_points,assist_points,clean_sheet_points,yellow_card_points,red_card_points,own_goal_points,
        total_points,input_hash,calculation_version,calculated_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        on conflict(player_id,match_id) do update set participation_points=excluded.participation_points,
        goal_points=excluded.goal_points,assist_points=excluded.assist_points,
        clean_sheet_points=excluded.clean_sheet_points,yellow_card_points=excluded.yellow_card_points,
        red_card_points=excluded.red_card_points,own_goal_points=excluded.own_goal_points,
        total_points=excluded.total_points,input_hash=excluded.input_hash,
        calculation_version=excluded.calculation_version,calculated_at=excluded.calculated_at`,
      [row.player_id as string, row.match_id as string, gameweekId, points.participationPoints, points.goalPoints,
        points.assistPoints, points.cleanSheetPoints, points.yellowCardPoints, points.redCardPoints,
        points.ownGoalPoints, points.totalPoints, hash, SCORING_VERSION, at]);
    }
    const teams = await tx.query<{ fantasy_team_id: string }>('select distinct fantasy_team_id from lineups where gameweek_id=$1', [gameweekId]);
    for (const team of teams) await scoreTeam(tx, team.fantasy_team_id, gameweekId, at);
    return teams.length;
  });
  return { players: rows.length, teams: teamCount };
}

async function scoreTeam(tx: PostgresExecutor, teamId: string, gameweekId: string, at: string): Promise<void> {
  const lineup = await tx.one<{ captain_player_id: string; vice_captain_player_id: string }>(
    'select captain_player_id,vice_captain_player_id from lineups where fantasy_team_id=$1 and gameweek_id=$2',
    [teamId, gameweekId]);
  const activeChip = await tx.maybeOne<{ chip_id: string }>(
    'select chip_id from team_chips where fantasy_team_id=$1 and active_gameweek_id=$2', [teamId, gameweekId]);
  const includeBench = activeChip?.chip_id === 'bench_boost';
  const points = await tx.query<{ player_id: string; points: string | number; participated: string | number }>(`select lp.player_id,
    coalesce(sum(pfp.total_points),0) as points,coalesce(max(pfp.participation_points),0) as participated
    from lineup_players lp left join player_fantasy_points pfp on pfp.player_id=lp.player_id and pfp.gameweek_id=lp.gameweek_id
    where lp.fantasy_team_id=$1 and lp.gameweek_id=$2 and (lp.role='STARTER' or $3::boolean)
    group by lp.player_id`, [teamId, gameweekId, includeBench]);
  const playerPoints = points.reduce((sum, row) => sum + Number(row.points), 0);
  const captain = points.find(row => row.player_id === lineup.captain_player_id);
  const vice = points.find(row => row.player_id === lineup.vice_captain_player_id);
  const captainPlayed = Boolean(Number(captain?.participated ?? 0));
  const rawCaptain = captainPlayed ? Number(captain?.points ?? 0) : Number(vice?.points ?? 0);
  const captainBonus = rawCaptain * (captainPlayed && activeChip?.chip_id === 'triple_cap' ? 2 : 1);
  const penaltyRow = await tx.one<{ value: string | number }>(
    'select coalesce(sum(points_cost),0) as value from transfers where fantasy_team_id=$1 and gameweek_id=$2',
    [teamId, gameweekId]);
  const penalty = Number(penaltyRow.value);
  const total = playerPoints + captainBonus - penalty;
  const hash = createHash('sha256').update(JSON.stringify({ points, captainBonus, penalty, version: SCORING_VERSION })).digest('hex');
  const existed = Boolean(await tx.maybeOne('select 1 from team_gameweek_scores where fantasy_team_id=$1 and gameweek_id=$2', [teamId, gameweekId]));
  await tx.execute(`insert into team_gameweek_scores(fantasy_team_id,gameweek_id,player_points,captain_bonus,
    transfer_penalty,total_points,input_hash,calculation_version,calculated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)
    on conflict(fantasy_team_id,gameweek_id) do update set player_points=excluded.player_points,
    captain_bonus=excluded.captain_bonus,transfer_penalty=excluded.transfer_penalty,total_points=excluded.total_points,
    input_hash=excluded.input_hash,calculation_version=excluded.calculation_version,calculated_at=excluded.calculated_at`,
  [teamId, gameweekId, playerPoints, captainBonus, penalty, total, hash, SCORING_VERSION, at]);
  await tx.execute(`update fantasy_teams set gameweek_points=$1,
    total_points=(select coalesce(sum(total_points),0) from team_gameweek_scores where fantasy_team_id=$2),
    free_transfers=case when $3::boolean=false then least(2,free_transfers+1) else free_transfers end,
    transfer_penalty_points=0,updated_at=$4 where id=$2`, [total, teamId, existed, at]);
  await tx.execute(`update team_chips set used_gameweek_id=$1,active_gameweek_id=null
    where fantasy_team_id=$2 and active_gameweek_id=$1`, [gameweekId, teamId]);
}

export async function recalculateLatestPricesPostgres(
  db: PostgresDatabase,
  tournamentId = 'apertura-2026',
): Promise<PricingRunResult | { updated: 0; skipped: true; formulaVersion: string }> {
  const config = pricingConfigFromEnv();
  const gameweek = await db.maybeOne<{ id: string }>(`select id from gameweeks where tournament_id=$1 and status='FINISHED'
    order by week_number desc limit 1`, [tournamentId]);
  if (!gameweek) return { updated: 0, skipped: true, formulaVersion: config.formulaVersion };
  return db.transaction(async tx => {
    await tx.execute('select pg_advisory_xact_lock(hashtext($1))', [`pricing:${tournamentId}:${gameweek.id}:${config.formulaVersion}`]);
    const existing = await tx.maybeOne<{ id: string; input_hash: string }>(`select id,input_hash from pricing_runs
      where tournament_id=$1 and as_of_gameweek_id=$2 and formula_version=$3 and status='COMPLETED'
      order by completed_at desc limit 1`, [tournamentId, gameweek.id, config.formulaVersion]);
    if (existing) return {
      runId: existing.id, tournamentId, asOfGameweekId: gameweek.id, formulaVersion: config.formulaVersion,
      inputHash: existing.input_hash, updated: 0, bootstrap: false, idempotent: true, quotes: [],
    };
    const input = await buildPricingInput(tx, tournamentId, gameweek.id, config);
    const bootstrap = !await tx.maybeOne(`select 1 from pricing_runs where tournament_id=$1 and formula_version=$2
      and status='COMPLETED' limit 1`, [tournamentId, config.formulaVersion]);
    const quotes = calculatePriceQuotes(input, { bootstrap });
    const inputHash = quotes[0]?.inputHash ?? createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const runId = randomUUID();
    const at = timestamp();
    await tx.execute(`insert into pricing_runs(id,tournament_id,as_of_gameweek_id,formula_version,config_json,
      input_hash,status,created_at) values($1,$2,$3,$4,$5::jsonb,$6,'RUNNING',$7)`,
    [runId, tournamentId, gameweek.id, config.formulaVersion, JSON.stringify(config), inputHash, at]);
    const byId = new Map(input.players.map(player => [player.playerId, player]));
    for (const quote of quotes) {
      const previous = byId.get(quote.playerId)!.previousPriceCents;
      const player = byId.get(quote.playerId)!;
      await tx.execute(`insert into player_price_history(pricing_run_id,tournament_id,player_id,gameweek_id,
        previous_price_cents,current_price_cents,change_cents,fair_price_cents,season_points_percentile,
        recent_form_percentile,points_per_appearance_percentile,performance_index,adjusted_performance,
        confidence,season_points,recent_form,points_per_appearance,participation_rate,formula_version,effective_at,market_momentum)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [runId, tournamentId, quote.playerId, gameweek.id, previous, quote.currentPriceCents,
        quote.currentPriceCents - previous, quote.fairPriceCents, quote.seasonPointsPercentile,
        quote.recentFormPercentile, quote.pointsPerAppearancePercentile, quote.performanceIndex,
        quote.adjustedPerformance, quote.confidence, player.seasonPoints, quote.recentForm,
        quote.pointsPerAppearance, quote.participationRate, config.formulaVersion, at, quote.marketMomentum]);
      await tx.execute(`update tournament_players set previous_price_cents=price_cents,price_cents=$1,
        fair_price_cents=$2,last_change_cents=$3,last_calculated_gameweek_id=$4,pricing_status='CURRENT',
        pricing_version=$5,price_updated_at=$6 where tournament_id=$7 and player_id=$8`,
      [quote.currentPriceCents, quote.fairPriceCents, quote.currentPriceCents - previous, gameweek.id,
        config.formulaVersion, at, tournamentId, quote.playerId]);
    }
    await tx.execute("update pricing_runs set status='COMPLETED',completed_at=$1 where id=$2", [at, runId]);
    return { runId, tournamentId, asOfGameweekId: gameweek.id, formulaVersion: config.formulaVersion,
      inputHash, updated: quotes.length, bootstrap, idempotent: false, quotes };
  });
}

async function buildPricingInput(
  db: PostgresExecutor,
  tournamentId: string,
  gameweekId: string,
  config: ReturnType<typeof pricingConfigFromEnv>,
): Promise<PricingEngineInput> {
  const asOf = await db.one<{ week_number: number; status: string }>(
    'select week_number,status from gameweeks where id=$1 and tournament_id=$2', [gameweekId, tournamentId]);
  if (asOf.status !== 'FINISHED') throw new Error('Los precios solo pueden calcularse después de cerrar la jornada.');
  const recent = (await db.query<{ id: string; week_number: number }>(`select distinct gw.id,gw.week_number
    from gameweeks gw join player_fantasy_points pfp on pfp.gameweek_id=gw.id join matches m on m.id=pfp.match_id
    where gw.tournament_id=$1 and gw.week_number<=$2 and m.score_status in ('CONFIRMED','CORRECTED')
    order by gw.week_number desc limit $3`, [tournamentId, asOf.week_number, config.recentWindowGameweeks])).reverse();
  const rows = await db.query<{ player_id: string; position: PricingPosition; previous_price_cents: string | number;
    season_points: string | number; appearances: string | number; eligible_matches: string | number }>(`select
    tp.player_id,p.position,tp.price_cents as previous_price_cents,coalesce(points.season_points,0) as season_points,
    coalesce(stats.appearances,0) as appearances,coalesce(eligible.eligible_matches,0) as eligible_matches
    from tournament_players tp join players p on p.id=tp.player_id
    left join (select pfp.player_id,sum(pfp.total_points) season_points from player_fantasy_points pfp
      join gameweeks gw on gw.id=pfp.gameweek_id join matches m on m.id=pfp.match_id
      where gw.tournament_id=$1 and gw.week_number<=$2 and m.score_status in ('CONFIRMED','CORRECTED') group by pfp.player_id) points on points.player_id=p.id
    left join (select pms.player_id,count(distinct case when coalesce(pms.minutes,0)>0 or pms.starter or pms.substitute_in then pms.match_id end) appearances
      from player_match_stats pms join matches m on m.id=pms.match_id join gameweeks gw on gw.id=m.gameweek_id
      where gw.tournament_id=$1 and gw.week_number<=$2 and m.score_status in ('CONFIRMED','CORRECTED') group by pms.player_id) stats on stats.player_id=p.id
    left join (select club.id club_id,count(distinct m.id) eligible_matches from clubs club join matches m on m.home_club_id=club.id or m.away_club_id=club.id
      join gameweeks gw on gw.id=m.gameweek_id where gw.tournament_id=$1 and gw.week_number<=$2 and m.score_status in ('CONFIRMED','CORRECTED') group by club.id) eligible on eligible.club_id=p.club_id
    where tp.tournament_id=$1 and tp.active and p.active order by tp.player_id`, [tournamentId, asOf.week_number]);
  const recentIds = recent.map(row => row.id);
  const recentPlaceholders = recentIds.map((_, index) => `$${index + 1}`).join(',');
  const recentRows = recentIds.length ? await db.query<{ player_id: string; gameweek_id: string; points: string | number }>(`select
    pfp.player_id,pfp.gameweek_id,sum(pfp.total_points) points from player_fantasy_points pfp join matches m on m.id=pfp.match_id
    where pfp.gameweek_id in (${recentPlaceholders}) and m.score_status in ('CONFIRMED','CORRECTED')
    group by pfp.player_id,pfp.gameweek_id`, recentIds) : [];
  const recentByPlayer = new Map<string, Map<string, number>>();
  for (const row of recentRows) {
    if (!recentByPlayer.has(row.player_id)) recentByPlayer.set(row.player_id, new Map());
    recentByPlayer.get(row.player_id)!.set(row.gameweek_id, Number(row.points));
  }
  const players: PlayerPricingInput[] = rows.map(row => ({
    playerId: row.player_id, position: row.position, seasonPoints: Number(row.season_points),
    recentGameweekPoints: recentIds.map(id => recentByPlayer.get(row.player_id)?.get(id) ?? 0),
    appearances: Number(row.appearances), eligibleMatches: Number(row.eligible_matches),
    previousPriceCents: Number(row.previous_price_cents),
  }));
  return { tournamentId, asOfGameweekId: gameweekId, config: { ...config, marketMomentumEnabled: false }, players };
}
