/**
 * Fantasy LPF - Official Transfer Engine
 * Strictly implements FPL-inspired transfer mechanics adapted to Liga Panameña de Fútbol:
 * - 15-player squad (2 GK, 5 DEF, 5 MID, 3 FWD)
 * - $100.0M Fantasy budget
 * - Max 3 players per LPF club
 * - 1 free transfer per GW, accumulates to MAX 2 (never 3, never 5)
 * - Additional transfers cost -4 fantasy points each
 * - Comodín (Wildcard): 1 per tournament, gives unlimited free transfers (0 pts)
 * - Lineup changes (Starters <-> Bench) are NEVER counted as transfers
 */

import { Player, FantasyTeam, TransferHistoryRecord, Position } from '../types/fantasy';

export const TRANSFER_RULES = {
  freePerRound: 1,
  maxBanked: 2,
  penaltyPerExtraTransfer: 4,
  maxPlayersPerClub: 3,
  squadSize: 15,
  requiredComposition: {
    GK: 2,
    DEF: 5,
    MID: 5,
    FWD: 3,
  } as Record<Position, number>,
} as const;

export interface TransferValidationResult {
  valid: boolean;
  error?: string;
  resultingBudget: number;
  pointsCost: number;
  isFreeTransfer: boolean;
  isComodinUsed: boolean;
  remainingFreeTransfers: number;
}

/**
 * Calculates the cost in fantasy points for an operation
 */
export function calculateTransferCost(
  currentFreeTransfers: number,
  comodinActive: boolean = false,
  isPreTournament: boolean = false
): { pointsCost: number; isFree: boolean; nextFreeTransfers: number } {
  // Pre-tournament or Comodín active: completely free
  if (isPreTournament || comodinActive) {
    return {
      pointsCost: 0,
      isFree: true,
      nextFreeTransfers: Math.max(0, currentFreeTransfers),
    };
  }

  // If user has at least 1 free transfer available:
  if (currentFreeTransfers > 0) {
    return {
      pointsCost: 0,
      isFree: true,
      nextFreeTransfers: Math.max(0, currentFreeTransfers - 1),
    };
  }

  // No free transfers left: costs 4 points
  return {
    pointsCost: TRANSFER_RULES.penaltyPerExtraTransfer,
    isFree: false,
    nextFreeTransfers: 0,
  };
}

/**
 * Validates whether a transfer can be executed under LPF rules
 */
export function validateTransfer(
  team: FantasyTeam,
  playerToBuy: Player,
  playerToSell: Player,
  allSquadPlayers: Player[],
  deadlinePassed: boolean = false
): TransferValidationResult {
  // 1. Deadline check
  if (deadlinePassed) {
    return {
      valid: false,
      error: 'El mercado está cerrado para esta jornada (deadline vencido).',
      resultingBudget: team.budgetRemaining,
      pointsCost: 0,
      isFreeTransfer: false,
      isComodinUsed: false,
      remainingFreeTransfers: team.freeTransfers,
    };
  }

  // 2. Player to sell must be in user's team
  const isOwned = team.starters.includes(playerToSell.id) || team.bench.includes(playerToSell.id);
  if (!isOwned) {
    return {
      valid: false,
      error: `${playerToSell.displayName} no pertenece a tu plantilla.`,
      resultingBudget: team.budgetRemaining,
      pointsCost: 0,
      isFreeTransfer: false,
      isComodinUsed: false,
      remainingFreeTransfers: team.freeTransfers,
    };
  }

  // 3. Player to buy must be active
  if (playerToBuy.status === 'INACTIVE') {
    return {
      valid: false,
      error: `${playerToBuy.displayName} no está activo en la LPF.`,
      resultingBudget: team.budgetRemaining,
      pointsCost: 0,
      isFreeTransfer: false,
      isComodinUsed: false,
      remainingFreeTransfers: team.freeTransfers,
    };
  }

  // 4. Duplicate player check
  const alreadyInSquad = team.starters.includes(playerToBuy.id) || team.bench.includes(playerToBuy.id);
  if (alreadyInSquad) {
    return {
      valid: false,
      error: `${playerToBuy.displayName} ya está en tu plantilla.`,
      resultingBudget: team.budgetRemaining,
      pointsCost: 0,
      isFreeTransfer: false,
      isComodinUsed: false,
      remainingFreeTransfers: team.freeTransfers,
    };
  }

  // 5. Position compatibility: direct 1-to-1 swap must match position to preserve 2-5-5-3
  if (playerToBuy.position !== playerToSell.position) {
    return {
      valid: false,
      error: `No puedes sustituir un ${playerToSell.position} por un ${playerToBuy.position}. Las posiciones deben coincidir.`,
      resultingBudget: team.budgetRemaining,
      pointsCost: 0,
      isFreeTransfer: false,
      isComodinUsed: false,
      remainingFreeTransfers: team.freeTransfers,
    };
  }

  // 6. Financial check: budget in bank + sell value >= buy price
  const sellPrice = playerToSell.sellingPrice ?? playerToSell.price;
  const buyPrice = playerToBuy.price;
  const availableFunds = Math.round((team.budgetRemaining + sellPrice) * 10) / 10;
  const resultingBudget = Math.round((availableFunds - buyPrice) * 10) / 10;

  if (resultingBudget < 0) {
    const diff = Math.abs(resultingBudget).toFixed(1);
    return {
      valid: false,
      error: `Presupuesto insuficiente. Fondos disponibles: $${availableFunds.toFixed(1)}M. Te faltan $${diff}M.`,
      resultingBudget,
      pointsCost: 0,
      isFreeTransfer: false,
      isComodinUsed: false,
      remainingFreeTransfers: team.freeTransfers,
    };
  }

  // 7. Max 3 players per LPF club check
  if (playerToBuy.clubId !== playerToSell.clubId) {
    // Count how many players the user currently has from playerToBuy's club
    const clubCount = allSquadPlayers.filter(p => p.id !== playerToSell.id && p.clubId === playerToBuy.clubId).length;
    if (clubCount >= TRANSFER_RULES.maxPlayersPerClub) {
      return {
        valid: false,
        error: `Límite alcanzado: Ya tienes ${clubCount} jugadores de ${playerToBuy.clubName} (máximo 3 por club).`,
        resultingBudget,
        pointsCost: 0,
        isFreeTransfer: false,
        isComodinUsed: false,
        remainingFreeTransfers: team.freeTransfers,
      };
    }
  }

  // 8. Calculate points penalty and free transfer deduction
  const isComodinActive = !!team.comodinActiveInGw || team.activeChip === 'wildcard';
  const { pointsCost, isFree, nextFreeTransfers } = calculateTransferCost(
    team.freeTransfers,
    isComodinActive
  );

  return {
    valid: true,
    resultingBudget,
    pointsCost,
    isFreeTransfer: isFree,
    isComodinUsed: isComodinActive,
    remainingFreeTransfers: nextFreeTransfers,
  };
}

export interface ExecuteTransferResult {
  success: boolean;
  updatedTeam?: FantasyTeam;
  historyRecord?: TransferHistoryRecord;
  error?: string;
}

/**
 * Pure function: applies a transfer to the team and generates an auditable history record
 */
export function executeTransfer(
  team: FantasyTeam,
  playerToBuy: Player,
  playerToSell: Player,
  allSquadPlayers: Player[],
  gameweekName: string = 'J12',
  deadlinePassed: boolean = false
): ExecuteTransferResult {
  const validation = validateTransfer(team, playerToBuy, playerToSell, allSquadPlayers, deadlinePassed);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error || 'Transferencia no válida',
    };
  }

  const isStarter = team.starters.includes(playerToSell.id);
  const newStarters = isStarter
    ? team.starters.map(id => (id === playerToSell.id ? playerToBuy.id : id))
    : [...team.starters];
  const newBench = !isStarter
    ? team.bench.map(id => (id === playerToSell.id ? playerToBuy.id : id))
    : [...team.bench];

  const newCap = team.captainId === playerToSell.id ? playerToBuy.id : team.captainId;
  const newVice = team.viceCaptainId === playerToSell.id ? playerToBuy.id : team.viceCaptainId;

  const currentPenalty = team.transferPenaltyPoints || 0;
  const newPenalty = currentPenalty + validation.pointsCost;

  const updatedTeam: FantasyTeam = {
    ...team,
    starters: newStarters,
    bench: newBench,
    budgetRemaining: validation.resultingBudget,
    captainId: newCap,
    viceCaptainId: newVice,
    freeTransfers: validation.remainingFreeTransfers,
    transferPenaltyPoints: newPenalty,
    // If penalty points were incurred, they deduct from total fantasy score
    totalPoints: team.totalPoints - validation.pointsCost,
  };

  const sellPrice = playerToSell.sellingPrice ?? playerToSell.price;
  const buyPrice = playerToBuy.price;
  const balanceDiff = Math.round((sellPrice - buyPrice) * 10) / 10;

  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  const historyRecord: TransferHistoryRecord = {
    id: `transfer-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    gameweek: gameweekName,
    dateStr: `Hoy, ${timeStr} • Confirmado`,
    playerInName: playerToBuy.displayName,
    playerInClub: `${playerToBuy.clubName} • ${playerToBuy.position}`,
    playerInPos: playerToBuy.position,
    playerInPrice: buyPrice,
    playerOutName: playerToSell.displayName,
    playerOutClub: `${playerToSell.clubName} • ${playerToSell.position}`,
    playerOutPos: playerToSell.position,
    playerOutPrice: sellPrice,
    balanceDiff,
    pointsCost: validation.pointsCost,
    isFreeTransfer: validation.isFreeTransfer,
    auditTag: validation.isComodinUsed
      ? '0 PTS (COMODÍN ACTIVO)'
      : validation.isFreeTransfer
      ? '0 PTS (FICHAJE GRATUITO)'
      : `-${validation.pointsCost} PTS (PENALIZACIÓN)`,
  };

  return { success: true, updatedTeam, historyRecord };
}

/**
 * Calculates free transfers for the NEXT gameweek adhering to FPL rules:
 * - 1 new free transfer is awarded every gameweek.
 * - Maximum accumulated free transfers is capped at 2 (never 3, never 5).
 */
export function rollGameweekFreeTransfers(currentBanked: number): number {
  return Math.min(TRANSFER_RULES.maxBanked, currentBanked + TRANSFER_RULES.freePerRound);
}
