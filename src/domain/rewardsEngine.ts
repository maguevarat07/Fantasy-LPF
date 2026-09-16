/**
 * Fantasy LPF - Dynamic Rewards & Tactical Mastery Engine
 * 
 * Implements a gamified, dynamic reward algorithm designed to keep managers actively engaged:
 * 1. Manager Level & Experience: Earn XP through real league points + tactical missions.
 * 2. Milestone Unlocks: Specific point thresholds grant access to tactical chips (Wildcard, Triple Captain, Bench Boost, Emergency Fund).
 * 3. Weekly Quests: Dynamic gameweek challenges that reward bonus mastery XP to accelerate unlocks.
 * 4. Gameweek Tactical Chest: A time-based / round-loyalty reward drop with mystery tactical boosts.
 * 5. Functional Chip Execution: Directly empowers the squad with real multipliers, unlimited transfers, extra budget, and bench scoring.
 */

import { FantasyTeam, ChipId } from '../types/fantasy';

export interface ManagerLevelInfo {
  level: number;
  title: string;
  badge: string;
  currentXp: number;
  minXp: number;
  maxXp: number;
  progressPercent: number;
  xpToNextLevel: number;
}

export interface RewardMilestone {
  id: string;
  title: string;
  thresholdPoints: number;
  chipRewardId: ChipId;
  chipName: string;
  badge: string;
  description: string;
  effectSummary: string;
  isUnlocked: boolean;
  isClaimed: boolean;
}

export interface WeeklyQuest {
  id: string;
  title: string;
  description: string;
  icon: string;
  xpReward: number;
  isCompleted: boolean;
  isClaimed: boolean;
  progressText: string;
}

export interface TacticalChestDrop {
  id: string;
  title: string;
  description: string;
  xpBonus: number;
  budgetBonus?: number;
  unlockedChipId?: ChipId;
  message: string;
}

// 7 Manager Mastery Tiers
export const MANAGER_TIERS = [
  { level: 1, title: 'Novato LPF', minXp: 0, maxXp: 200, badge: 'BRONCE' },
  { level: 2, title: 'Estratega Promesa', minXp: 200, maxXp: 400, badge: 'PLATA' },
  { level: 3, title: 'Director Técnico', minXp: 400, maxXp: 600, badge: 'ORO' },
  { level: 4, title: 'Mánager Táctico', minXp: 600, maxXp: 740, badge: 'PLATINO' },
  { level: 5, title: 'DT Élite Canalero', minXp: 740, maxXp: 850, badge: 'ÉLITE' },
  { level: 6, title: 'Leyenda del Banquillo', minXp: 850, maxXp: 1000, badge: 'MAESTRO' },
  { level: 7, title: 'Maestro del Rommel', minXp: 1000, maxXp: 1250, badge: 'LEYENDA' }
];

// Official Milestones to unlock Comodines based on league points
export const REWARD_MILESTONES_CONFIG = [
  {
    id: 'milestone-wildcard',
    title: 'Comodín LPF (Wildcard)',
    thresholdPoints: 600,
    chipRewardId: 'wildcard' as ChipId,
    chipName: 'Comodín LPF',
    badge: 'DESBLOQUEADO',
    description: 'Fichajes ilimitados sin ninguna deducción de -4 puntos en la jornada activa.',
    effectSummary: '0 pts en todos los fichajes'
  },
  {
    id: 'milestone-triple-cap',
    title: 'Triple Capitán (3x)',
    thresholdPoints: 750,
    chipRewardId: 'triple_cap' as ChipId,
    chipName: 'Triple Capitán',
    badge: 'META CERCANA',
    description: 'Tu capitán seleccionado triplica su puntuación en vez del doble tradicional (x3 multiplicador).',
    effectSummary: 'Capitán puntúa x3'
  },
  {
    id: 'milestone-bench-boost',
    title: 'Banquillo Potenciado',
    thresholdPoints: 800,
    chipRewardId: 'bench_boost' as ChipId,
    chipName: 'Banquillo Potenciado',
    badge: 'BLOQUEADO',
    description: 'Los puntos de los 4 suplentes en el banquillo se suman automáticamente al total de tu equipo.',
    effectSummary: 'Los 4 suplentes puntúan en la jornada activa'
  },
  {
    id: 'milestone-emergency-fund',
    title: 'Fondo de Emergencia',
    thresholdPoints: 860,
    chipRewardId: 'emergency_fund' as ChipId,
    chipName: 'Fondo de Emergencia',
    badge: 'BLOQUEADO',
    description: 'Añade de inmediato +$5.0M de presupuesto salarial para fichar figuras estelares.',
    effectSummary: '+$5.0M Presupuesto Extra'
  }
];

// Gameweek 12 Dynamic Quests
export const INITIAL_WEEKLY_QUESTS: WeeklyQuest[] = [
  {
    id: 'quest-lineup-ready',
    title: 'Once de Gala Confirmado',
    description: 'Guarda tu alineación titular con 11 jugadores sin lesionados ni suspendidos.',
    icon: 'check_circle',
    xpReward: 20,
    isCompleted: true,
    isClaimed: true,
    progressText: '11/11 Listos'
  },
  {
    id: 'quest-forward-threat',
    title: 'Artillería Goleadora',
    description: 'Mantén en tu once a un delantero con más de 7 goles en el Torneo Apertura.',
    icon: 'sports_soccer',
    xpReward: 25,
    isCompleted: true,
    isClaimed: false,
    progressText: 'R. Córdoba (9 goles)'
  },
  {
    id: 'quest-market-scout',
    title: 'Scouting en el Mercado',
    description: 'Explora y filtra jugadores de la LPF buscando jóvenes promesas o gangas.',
    icon: 'search',
    xpReward: 20,
    isCompleted: true,
    isClaimed: false,
    progressText: 'Completado'
  },
  {
    id: 'quest-tactical-master',
    title: 'Estratega del Rommel',
    description: 'Alinea al menos 4 defensores o mediocampistas con alta probabilidad de victoria.',
    icon: 'shield',
    xpReward: 25,
    isCompleted: false,
    isClaimed: false,
    progressText: '3/4 Táctico'
  }
];

/**
 * Calculates current manager level and progress percentage
 */
export function calculateManagerMastery(team: FantasyTeam): ManagerLevelInfo {
  const basePoints = team.totalPoints || 0;
  const bonusXp = team.masteryXp || 0;
  const totalXp = basePoints + bonusXp;

  // Find matching tier
  let tier = MANAGER_TIERS[0];
  for (let i = MANAGER_TIERS.length - 1; i >= 0; i--) {
    if (totalXp >= MANAGER_TIERS[i].minXp) {
      tier = MANAGER_TIERS[i];
      break;
    }
  }

  const range = tier.maxXp - tier.minXp;
  const progressInTier = Math.max(0, Math.min(range, totalXp - tier.minXp));
  const progressPercent = Math.round((progressInTier / range) * 100);
  const xpToNextLevel = Math.max(0, tier.maxXp - totalXp);

  return {
    level: tier.level,
    title: tier.title,
    badge: tier.badge,
    currentXp: totalXp,
    minXp: tier.minXp,
    maxXp: tier.maxXp,
    progressPercent,
    xpToNextLevel
  };
}

/**
 * Evaluates which milestones are unlocked or claimed based on points + XP
 */
export function getEvaluatedMilestones(team: FantasyTeam): RewardMilestone[] {
  const mastery = calculateManagerMastery(team);
  const currentPoints = mastery.currentXp;
  const claimedList = team.claimedMilestones || ['milestone-wildcard']; // Wildcard unlocked by default

  return REWARD_MILESTONES_CONFIG.map(m => {
    const isUnlocked = currentPoints >= m.thresholdPoints || claimedList.includes(m.id);
    const isClaimed = claimedList.includes(m.id);

    return {
      ...m,
      isUnlocked,
      isClaimed
    };
  });
}

/**
 * Checks if a specific chip is unlocked for the user
 */
export function isChipUnlocked(team: FantasyTeam, chipId: ChipId): boolean {
  // Check explicit unlocked list
  if (team.unlockedChips && team.unlockedChips.includes(chipId)) return true;

  // Check milestone eligibility
  const mastery = calculateManagerMastery(team);
  const milestone = REWARD_MILESTONES_CONFIG.find(m => m.chipRewardId === chipId);
  if (!milestone) return true;

  if (team.claimedMilestones && team.claimedMilestones.includes(milestone.id)) return true;
  return mastery.currentXp >= milestone.thresholdPoints;
}

/**
 * Functional Activation of a Chip in the user's squad
 * In fantasy rules, only 1 chip can be active per gameweek.
 */
export function activateChip(team: FantasyTeam, chipId: ChipId): FantasyTeam {
  // If switching from another active chip, revert prior chip first
  const updatedTeam = { ...team };

  if (team.emergencyFundActiveInGw && chipId !== 'emergency_fund') {
    // Revert previous emergency fund if active
    updatedTeam.totalBudget = 100.0;
    updatedTeam.budgetRemaining = Math.max(0, Math.round((updatedTeam.budgetRemaining - 5.0) * 10) / 10);
  }

  // Reset all active flags
  updatedTeam.activeChip = chipId;
  updatedTeam.comodinActiveInGw = chipId === 'wildcard';
  updatedTeam.tripleCaptainActiveInGw = chipId === 'triple_cap';
  updatedTeam.benchBoostActiveInGw = chipId === 'bench_boost';
  updatedTeam.emergencyFundActiveInGw = chipId === 'emergency_fund';

  // Apply specific chip benefits immediately
  if (chipId === 'wildcard') {
    updatedTeam.comodinAvailable = false;
    updatedTeam.comodinUsedInGw = 'Jornada actual';
  } else if (chipId === 'emergency_fund') {
    // Add +$5.0M to total budget and remaining budget
    updatedTeam.totalBudget = 105.0;
    updatedTeam.budgetRemaining = Math.round((updatedTeam.budgetRemaining + 5.0) * 10) / 10;
  }

  // Ensure it is recorded in unlockedChips
  const unlocked = new Set<ChipId>(updatedTeam.unlockedChips || ['wildcard']);
  unlocked.add(chipId);
  updatedTeam.unlockedChips = Array.from(unlocked) as ChipId[];

  return updatedTeam;
}

/**
 * Functional Deactivation of an active chip in the gameweek (e.g. user changes mind before deadline)
 */
export function deactivateChip(team: FantasyTeam, chipId: ChipId): FantasyTeam {
  const updatedTeam = { ...team };

  if (updatedTeam.activeChip === chipId) {
    updatedTeam.activeChip = null;
  }

  if (chipId === 'wildcard') {
    updatedTeam.comodinActiveInGw = false;
    updatedTeam.comodinAvailable = true;
  } else if (chipId === 'triple_cap') {
    updatedTeam.tripleCaptainActiveInGw = false;
  } else if (chipId === 'bench_boost') {
    updatedTeam.benchBoostActiveInGw = false;
  } else if (chipId === 'emergency_fund') {
    updatedTeam.emergencyFundActiveInGw = false;
    updatedTeam.totalBudget = 100.0;
    updatedTeam.budgetRemaining = Math.max(0, Math.round((updatedTeam.budgetRemaining - 5.0) * 10) / 10);
  }

  return updatedTeam;
}

/**
 * Generates a dynamic reward drop when opening the Tactical Gameweek Chest
 */
export function openTacticalChest(team: FantasyTeam): {
  updatedTeam: FantasyTeam;
  reward: TacticalChestDrop;
} {
  const mastery = calculateManagerMastery(team);
  const currentXp = mastery.currentXp;

  // If user is just short of 750 pts (e.g. at 742 pts), award enough XP to unlock Triple Captain!
  const xpNeededForTriple = Math.max(15, 750 - currentXp + 5);
  const awardedXp = xpNeededForTriple > 35 ? 25 : xpNeededForTriple;

  const reward: TacticalChestDrop = {
    id: `drop-${Date.now()}`,
    title: '¡Cofre Táctico LPF Reclamado!',
    description: `Has obtenido +${awardedXp} Puntos de Maestría y recarga estratégica para la Jornada 12.`,
    xpBonus: awardedXp,
    budgetBonus: 0.2,
    message: currentXp + awardedXp >= 750
      ? '¡FELICIDADES! Has superado los 750 pts de Maestría y has desbloqueado el comodín "Triple Capitán (3x)".'
      : 'Sigue sumando puntos para desbloquear el siguiente comodín.'
  };

  const newBonusXp = (team.masteryXp || 0) + awardedXp;
  const newBudgetRem = Math.round(((team.budgetRemaining || 2.4) + 0.2) * 10) / 10;

  // Check if this unlocked any new milestone
  const unlocked = new Set<ChipId>(team.unlockedChips || ['wildcard']);
  const claimed = new Set(team.claimedMilestones || ['milestone-wildcard']);

  if (currentXp + awardedXp >= 750) {
    unlocked.add('triple_cap');
    claimed.add('milestone-triple-cap');
  }

  const updatedTeam: FantasyTeam = {
    ...team,
    masteryXp: newBonusXp,
    budgetRemaining: newBudgetRem,
    unlockedChips: Array.from(unlocked) as ChipId[],
    claimedMilestones: Array.from(claimed),
    lastChestClaimedDate: new Date().toISOString()
  };

  return { updatedTeam, reward };
}
