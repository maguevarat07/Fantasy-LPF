/**
 * Fantasy LPF - Official Scoring & Rules Engine
 * Implements Section 7, 8, 9, 10, 11, 12, 13, 17, 18, 19, 20 of Fantasy LPF Master Plan v2.0
 */

import { Position, Formation, Player } from '../types/fantasy';

export const FANTASY_RULES = {
  budget: 100.0,
  squadSize: 15,
  maxPlayersPerClub: 3,

  squadComposition: {
    GK: 2,
    DEF: 5,
    MID: 5,
    FWD: 3
  },

  formations: [
    "3-4-3",
    "3-5-2",
    "4-3-3",
    "4-4-2",
    "4-5-1",
    "5-2-3",
    "5-3-2",
    "5-4-1"
  ] as const,

  points: {
    appearance: 1,
    assist: 3,
    yellowCard: -1,
    redCard: -3,
    ownGoal: -2,

    goal: {
      GK: 10,
      DEF: 6,
      MID: 5,
      FWD: 4
    },

    cleanSheet: {
      GK: 5,
      DEF: 4,
      MID: 0,
      FWD: 0
    }
  },

  transfers: {
    freePerRound: 1,
    maxBanked: 2,
    extraCost: 4
  },

  captainMultiplier: 2
} as const;

export interface PlayerPointsBreakdown {
  appearance: number;
  goals: number;
  assists: number;
  cleanSheet: number;
  yellowCards: number;
  redCards: number;
  ownGoals: number;
  baseTotal: number;
}

/**
 * Pure function: calculates canonical player points for a single match
 * Strictly forbids minutes-based tiered points, saves, MOTM or advanced stats (Master Plan Section 8 & 9)
 */
export function calculatePlayerMatchPoints(
  position: Position,
  stats: {
    played: boolean;
    goals: number;
    assistsConfirmed: number;
    cleanSheet: boolean;
    yellowCards: number;
    redCards: number;
    ownGoals: number;
  }
): PlayerPointsBreakdown {
  if (!stats.played) {
    return {
      appearance: 0,
      goals: 0,
      assists: 0,
      cleanSheet: 0,
      yellowCards: 0,
      redCards: 0,
      ownGoals: 0,
      baseTotal: 0
    };
  }

  const appearance = stats.played ? FANTASY_RULES.points.appearance : 0;
  const goals = stats.goals * FANTASY_RULES.points.goal[position];
  const assists = stats.assistsConfirmed * FANTASY_RULES.points.assist;
  const cleanSheet = stats.cleanSheet ? FANTASY_RULES.points.cleanSheet[position] : 0;
  const yellowCards = stats.yellowCards * FANTASY_RULES.points.yellowCard;
  const redCards = stats.redCards * FANTASY_RULES.points.redCard;
  const ownGoals = stats.ownGoals * FANTASY_RULES.points.ownGoal;

  const baseTotal = appearance + goals + assists + cleanSheet + yellowCards + redCards + ownGoals;

  return {
    appearance,
    goals,
    assists,
    cleanSheet,
    yellowCards,
    redCards,
    ownGoals,
    baseTotal
  };
}

/**
 * Validates whether the 11 starters form one of the 8 allowed tactical formations:
 * 3-4-3, 3-5-2, 4-3-3, 4-4-2, 4-5-1, 5-2-3, 5-3-2, 5-4-1
 */
export function validateFormation(starters: Player[]): { valid: boolean; detectedFormation?: Formation; error?: string } {
  if (starters.length !== 11) {
    return { valid: false, error: `Se requieren exactamente 11 titulares (actual: ${starters.length})` };
  }

  const counts = {
    GK: starters.filter(p => p.position === 'GK').length,
    DEF: starters.filter(p => p.position === 'DEF').length,
    MID: starters.filter(p => p.position === 'MID').length,
    FWD: starters.filter(p => p.position === 'FWD').length
  };

  if (counts.GK !== 1) {
    return { valid: false, error: `Debe haber exactamente 1 portero titular (actual: ${counts.GK})` };
  }

  const formationKey = `${counts.DEF}-${counts.MID}-${counts.FWD}` as Formation;

  if (FANTASY_RULES.formations.includes(formationKey)) {
    return { valid: true, detectedFormation: formationKey };
  }

  return { 
    valid: false, 
    error: `Formación ${counts.DEF}-${counts.MID}-${counts.FWD} no permitida. Mínimo 3 DEF, 2 MID, 1 FWD.` 
  };
}

/**
 * Validates entire squad compliance
 */
export function validateSquad(
  allPlayers: Player[],
  starters: Player[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (allPlayers.length !== FANTASY_RULES.squadSize) {
    errors.push(`La plantilla debe contener exactamente 15 jugadores (actual: ${allPlayers.length})`);
  }

  const counts = {
    GK: allPlayers.filter(p => p.position === 'GK').length,
    DEF: allPlayers.filter(p => p.position === 'DEF').length,
    MID: allPlayers.filter(p => p.position === 'MID').length,
    FWD: allPlayers.filter(p => p.position === 'FWD').length
  };

  if (counts.GK !== 2) errors.push(`Debes tener exactamente 2 Porteros (actual: ${counts.GK})`);
  if (counts.DEF !== 5) errors.push(`Debes tener exactamente 5 Defensas (actual: ${counts.DEF})`);
  if (counts.MID !== 5) errors.push(`Debes tener exactamente 5 Mediocampistas (actual: ${counts.MID})`);
  if (counts.FWD !== 3) errors.push(`Debes tener exactamente 3 Delanteros (actual: ${counts.FWD})`);

  const totalPrice = allPlayers.reduce((acc, p) => acc + p.price, 0);
  if (totalPrice > FANTASY_RULES.budget) {
    errors.push(`Presupuesto excedido: $${totalPrice.toFixed(1)}M > $${FANTASY_RULES.budget}M`);
  }

  const clubCounts: Record<string, number> = {};
  allPlayers.forEach(p => {
    clubCounts[p.clubId] = (clubCounts[p.clubId] || 0) + 1;
    if (clubCounts[p.clubId] > FANTASY_RULES.maxPlayersPerClub) {
      errors.push(`Máximo 3 jugadores por club excedido en ${p.clubName}`);
    }
  });

  const formationCheck = validateFormation(starters);
  if (!formationCheck.valid && formationCheck.error) {
    errors.push(formationCheck.error);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
