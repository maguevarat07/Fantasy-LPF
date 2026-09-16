import { createHash } from 'node:crypto';
import type { SqliteDatabase } from './db.js';

const GOAL_POINTS: Record<string, number> = { GK: 10, DEF: 6, MID: 5, FWD: 4 };
export const SCORING_VERSION = 'lpf-v1';

export interface ScoringInput {
  position: string;
  started: boolean;
  substituteIn: boolean;
  goals: number;
  confirmedAssists: number;
  yellowCards: number;
  redCards: number;
  ownGoals: number;
  cleanSheet: boolean;
}

export function calculatePlayerPoints(input: ScoringInput) {
  const participationPoints = input.started || input.substituteIn ? 1 : 0;
  const goalPoints = input.goals * (GOAL_POINTS[input.position] ?? 0);
  const assistPoints = input.confirmedAssists * 3;
  const cleanSheetPoints = input.cleanSheet ? (input.position === 'GK' ? 5 : input.position === 'DEF' ? 4 : 0) : 0;
  const yellowCardPoints = input.yellowCards * -1;
  const redCardPoints = input.redCards * -3;
  const ownGoalPoints = input.ownGoals * -2;
  return {
    participationPoints, goalPoints, assistPoints, cleanSheetPoints,
    yellowCardPoints, redCardPoints, ownGoalPoints,
    totalPoints: participationPoints + goalPoints + assistPoints + cleanSheetPoints
      + yellowCardPoints + redCardPoints + ownGoalPoints,
  };
}

export function recalculateGameweek(db: SqliteDatabase, gameweekId: string): { players: number; teams: number } {
  const timestamp = new Date().toISOString();
  const rows = db.prepare(`SELECT s.*, p.position, p.club_id AS player_club_id,
    m.home_club_id, m.away_club_id, m.home_score, m.away_score
    FROM player_match_stats s JOIN players p ON p.id = s.player_id JOIN matches m ON m.id = s.match_id
    WHERE m.gameweek_id = ? AND m.score_status IN ('CONFIRMED', 'CORRECTED')`).all(gameweekId) as Array<Record<string, unknown>>;
  const savePlayer = db.prepare(`INSERT INTO player_fantasy_points
    (player_id, match_id, gameweek_id, participation_points, goal_points, assist_points,
      clean_sheet_points, yellow_card_points, red_card_points, own_goal_points, total_points,
      input_hash, calculation_version, calculated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(player_id, match_id) DO UPDATE SET participation_points=excluded.participation_points,
      goal_points=excluded.goal_points, assist_points=excluded.assist_points,
      clean_sheet_points=excluded.clean_sheet_points, yellow_card_points=excluded.yellow_card_points,
      red_card_points=excluded.red_card_points, own_goal_points=excluded.own_goal_points,
      total_points=excluded.total_points, input_hash=excluded.input_hash,
      calculation_version=excluded.calculation_version, calculated_at=excluded.calculated_at`);
  db.transaction(() => {
    for (const row of rows) {
      const clubId = String(row.club_id ?? row.player_club_id ?? '');
      const opponentScore = clubId === row.home_club_id ? row.away_score : clubId === row.away_club_id ? row.home_score : null;
      const input: ScoringInput = {
        position: String(row.position), started: row.starter === 1, substituteIn: row.substitute_in === 1,
        goals: Number(row.goals ?? 0), confirmedAssists: row.assist_status === 'CONFIRMED' || row.assist_status === 'CORRECTED' ? Number(row.assists ?? 0) : 0,
        yellowCards: Number(row.yellow_cards ?? 0), redCards: Number(row.red_cards ?? 0), ownGoals: Number(row.own_goals ?? 0),
        cleanSheet: opponentScore === 0 && (row.starter === 1 || row.substitute_in === 1),
      };
      const points = calculatePlayerPoints(input);
      const hash = createHash('sha256').update(JSON.stringify({ row, input, version: SCORING_VERSION })).digest('hex');
      savePlayer.run(row.player_id, row.match_id, gameweekId, points.participationPoints, points.goalPoints,
        points.assistPoints, points.cleanSheetPoints, points.yellowCardPoints, points.redCardPoints,
        points.ownGoalPoints, points.totalPoints, hash, SCORING_VERSION, timestamp);
    }

    const teams = db.prepare(`SELECT DISTINCT fantasy_team_id FROM lineups WHERE gameweek_id = ?`).all(gameweekId) as Array<{ fantasy_team_id: string }>;
    const saveTeam = db.prepare(`INSERT INTO team_gameweek_scores
      (fantasy_team_id, gameweek_id, player_points, captain_bonus, transfer_penalty, total_points,
       input_hash, calculation_version, calculated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fantasy_team_id, gameweek_id) DO UPDATE SET player_points=excluded.player_points,
       captain_bonus=excluded.captain_bonus, transfer_penalty=excluded.transfer_penalty,
       total_points=excluded.total_points, input_hash=excluded.input_hash,
       calculation_version=excluded.calculation_version, calculated_at=excluded.calculated_at`);
    for (const team of teams) {
      const lineup = db.prepare(`SELECT captain_player_id, vice_captain_player_id FROM lineups
        WHERE fantasy_team_id = ? AND gameweek_id = ?`)
        .get(team.fantasy_team_id, gameweekId) as { captain_player_id: string; vice_captain_player_id: string };
      const activeChip = db.prepare('SELECT chip_id FROM team_chips WHERE fantasy_team_id = ? AND active_gameweek_id = ?')
        .get(team.fantasy_team_id, gameweekId) as { chip_id: string } | undefined;
      const roles = activeChip?.chip_id === 'bench_boost' ? "('STARTER','BENCH')" : "('STARTER')";
      const pointRows = db.prepare(`SELECT lp.player_id, COALESCE(SUM(pfp.total_points),0) AS points,
          COALESCE(MAX(pfp.participation_points), 0) AS participated
        FROM lineup_players lp LEFT JOIN player_fantasy_points pfp ON pfp.player_id=lp.player_id AND pfp.gameweek_id=lp.gameweek_id
        WHERE lp.fantasy_team_id=? AND lp.gameweek_id=? AND lp.role IN ${roles} GROUP BY lp.player_id`)
        .all(team.fantasy_team_id, gameweekId) as Array<{ player_id: string; points: number; participated: number }>;
      const playerPoints = pointRows.reduce((sum, row) => sum + Number(row.points), 0);
      const captain = pointRows.find(row => row.player_id === lineup.captain_player_id);
      const vice = pointRows.find(row => row.player_id === lineup.vice_captain_player_id);
      const captainParticipated = Boolean(captain?.participated);
      const captainRaw = captainParticipated ? Number(captain?.points ?? 0) : Number(vice?.points ?? 0);
      const captainBonus = captainRaw * (captainParticipated && activeChip?.chip_id === 'triple_cap' ? 2 : 1);
      const penalty = Number((db.prepare('SELECT COALESCE(SUM(points_cost),0) AS value FROM transfers WHERE fantasy_team_id=? AND gameweek_id=?')
        .get(team.fantasy_team_id, gameweekId) as { value: number }).value);
      const total = playerPoints + captainBonus - penalty;
      const hash = createHash('sha256').update(JSON.stringify({ pointRows, captainBonus, penalty, version: SCORING_VERSION })).digest('hex');
      const scoreAlreadyExisted = Boolean(db.prepare(`SELECT 1 FROM team_gameweek_scores
        WHERE fantasy_team_id = ? AND gameweek_id = ?`).get(team.fantasy_team_id, gameweekId));
      saveTeam.run(team.fantasy_team_id, gameweekId, playerPoints, captainBonus, penalty, total, hash, SCORING_VERSION, timestamp);
      db.prepare(`UPDATE fantasy_teams SET gameweek_points=?, total_points=(SELECT COALESCE(SUM(total_points),0)
        FROM team_gameweek_scores WHERE fantasy_team_id=?),
        free_transfers = CASE WHEN ? = 0 THEN MIN(2, free_transfers + 1) ELSE free_transfers END,
        transfer_penalty_points = 0, updated_at=? WHERE id=?`)
        .run(total, team.fantasy_team_id, Number(scoreAlreadyExisted), timestamp, team.fantasy_team_id);
      db.prepare(`UPDATE team_chips SET used_gameweek_id = ?, active_gameweek_id = NULL
        WHERE fantasy_team_id = ? AND active_gameweek_id = ?`)
        .run(gameweekId, team.fantasy_team_id, gameweekId);
    }
  })();
  const teamCount = Number((db.prepare('SELECT COUNT(DISTINCT fantasy_team_id) AS value FROM lineups WHERE gameweek_id=?').get(gameweekId) as { value: number }).value);
  return { players: rows.length, teams: teamCount };
}
