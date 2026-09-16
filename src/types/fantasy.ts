/**
 * Fantasy LPF - TypeScript Domain Interfaces
 * Strictly adheres to "Fantasy LPF — Especificación Técnica Maestra para Claude v2.0"
 */

export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';

export type Formation = 
  | '3-4-3'
  | '3-5-2'
  | '4-3-3'
  | '4-4-2'
  | '4-5-1'
  | '5-3-2';

export type PlayerStatus = 'ACTIVE' | 'INJURED' | 'SUSPENDED' | 'INACTIVE';

export type AssistStatus = 'CONFIRMED' | 'UNCONFIRMED' | 'CONFLICT' | 'NOT_AVAILABLE';

export type ScoreStatus = 'PENDING' | 'PROVISIONAL' | 'CONFIRMED' | 'CORRECTED';

export type MatchWeekStatus = 'OPEN' | 'LOCKED' | 'LIVE' | 'FINISHED';

export type MatchStatus = 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';

export type DataSource = 'LPF' | 'TRANSFERMARKT' | 'SOCCERWAY' | '365SCORES' | 'FOTMOB';

export interface Club {
  id: string;
  name: string;
  shortName: string;
  code: string;
  slug: string;
  city: string;
  stadium: string;
  logoUrl: string;
  primaryColor?: string;
  active: boolean;
}

export interface Player {
  id: string;
  name: string;
  displayName: string;
  clubId: string;
  clubCode: string;
  clubName: string;
  position: Position;
  shirtNumber: number;
  price: number; // in Millions, e.g. 9.0
  currentPrice?: number;
  previousPrice?: number;
  priceChange?: number;
  priceUpdatedAt?: string;
  pricingVersion?: string;
  priceHistory?: PlayerPriceHistoryPoint[];
  purchasePrice?: number;
  sellingPrice?: number;
  status: PlayerStatus;
  statusNote?: string;
  imageUrl: string;
  totalPoints: number;
  recentForm: number; // e.g. 9.2
  lastGwPoints: number; // e.g. 14
  goals: number;
  assists: number;
  cleanSheets: number;
  yellowCards: number;
  redCards: number;
  ownGoals: number;
  matchesPlayed: number;
  nextOpponent: string; // e.g. 'vs PLZ (C)'
  nextFdr: number; // 1 to 5
  historyLast5: { gw: string; points: number }[];
  breakdownLastGw?: {
    goalsPoints: number;
    assistsPoints: number;
    appearancePoints: number;
    cleanSheetPoints: number;
    bonusMvpPoints: number;
    yellowCardPoints: number;
    total: number;
    description: string;
  };
}

export interface PlayerPriceHistoryPoint {
  gameweekId: string;
  gameweekName?: string;
  price: number;
  change: number;
  effectiveAt: string;
}

export interface OwnedPlayerEconomy {
  playerId: string;
  currentPrice?: number;
  purchasePrice?: number;
  sellingPrice?: number;
  priceChange?: number;
  profitLoss?: number;
  purchaseGameweek?: string;
}

export type ChipId = 'wildcard' | 'triple_cap' | 'bench_boost' | 'emergency_fund';

export interface FantasyTeam {
  id: string;
  name: string;
  managerName: string;
  totalBudget: number; // 100.0M (or 105.0M if emergency fund active)
  budgetRemaining: number; // e.g. 2.4M
  currentMarketValue?: number;
  sellingSquadValue?: number;
  totalAvailableValue?: number;
  totalPoints: number; // e.g. 742
  lastGwPoints: number; // e.g. 68
  rankGlobal: number; // e.g. 142
  rankTotalManagers: number; // e.g. 35400
  formation: Formation;
  starters: string[]; // 11 player IDs
  bench: string[]; // 4 player IDs in substitution order [GK, DEF, MID, DEL]
  captainId: string;
  viceCaptainId: string;
  freeTransfers: number; // 1 or 2 (max 2)
  transfersBanked: number;
  transferPenaltyPoints?: number; // cumulative penalty for current GW
  // Comodines / Chips State
  comodinAvailable?: boolean; // 1 per tournament (wildcard)
  comodinActiveInGw?: boolean; // active in current round
  comodinUsedInGw?: string | null; // e.g. 'J12'
  activeChip?: ChipId | null; // currently active chip in GW12
  tripleCaptainActiveInGw?: boolean;
  benchBoostActiveInGw?: boolean;
  emergencyFundActiveInGw?: boolean;
  unlockedChips?: ChipId[];
  usedChips?: Partial<Record<ChipId, string>>;
  // Dynamic Manager Rewards & Mastery Pass
  masteryXp?: number; // bonus XP earned from quests / drops
  claimedMilestones?: string[];
  completedQuestIds?: string[];
  lastChestClaimedDate?: string | null;
}

export interface MatchWeek {
  id: string;
  weekNumber: number;
  name: string;
  startDate: string;
  endDate: string;
  deadline: string; // e.g. 'Viernes 18:00 EST'
  deadlineCountdown: string; // e.g. '1d 04h 12m'
  status: MatchWeekStatus;
}

export interface Match {
  id: string;
  matchWeekId: string;
  homeClubId: string;
  awayClubId: string;
  kickoff: string;
  stadium: string;
  homeScore: number | null;
  awayScore: number | null;
  status: MatchStatus;
  minute?: number;
  isClassic?: boolean;
  classicTitle?: string;
  fdr: number; // 1-5
}

export interface TransferDraft {
  playerOutId: string;
  playerInId: string;
  priceOut: number;
  priceIn: number;
  netCost: number;
}

export interface TransferHistoryRecord {
  id: string;
  gameweek: string;
  dateStr: string;
  playerInName: string;
  playerInClub: string;
  playerInPos: Position;
  playerInPrice: number;
  playerInBadgeNote?: string;
  playerOutName: string;
  playerOutClub: string;
  playerOutPos: Position;
  playerOutPrice: number;
  balanceDiff: number;
  pointsCost: number; // 0 or -4
  isFreeTransfer: boolean;
  auditTag?: string;
  purchasePrice?: number;
  sellingPrice?: number;
  profitLoss?: number;
  purchaseGameweek?: string;
  saleGameweek?: string;
}

export interface LeagueMember {
  id?: string;
  position: number;
  prevPosition: number;
  teamName: string;
  managerName: string;
  isCurrentUser: boolean;
  gwPoints: number;
  totalPoints: number;
  teamValue: number;
  avatarUrl: string;
  formation?: Formation;
  starters?: string[];
  bench?: string[];
  captainId?: string;
  viceCaptainId?: string;
}

export interface BoosterChip {
  id: string;
  name: string;
  badge: string;
  state: 'AVAILABLE' | 'USED' | 'LOCKED';
  stateLabel: string;
  description: string;
  validUntil?: string;
  lockedReason?: string;
  auditUsed?: {
    captainName: string;
    club: string;
    pointsScored: number;
    gameweek: string;
  };
}

export interface SourceObservation {
  id: string;
  source: DataSource;
  entityType: 'MATCH' | 'GOAL' | 'ASSIST' | 'CARD' | 'LINEUP';
  entityName: string;
  rawValue: string;
  normalizedValue: string;
  confidence: number;
  fetchedAt: string;
  sourceUrl: string;
  status: 'CONFIRMED' | 'PROVISIONAL' | 'CONFLICT' | 'NEEDS_REVIEW';
}

export interface UserProfile {
  id: string;
  username: string;
  managerName: string;
  teamName: string;
  email: string;
  phone: string;
  province: string;
  favoriteClubId: string;
  membershipId: string;
  memberSince: string;
  avatarUrl: string;
  notificationsEnabled: boolean;
  emailAlertsEnabled: boolean;
  twoFactorEnabled?: boolean;
}

export interface UserLeagueEnrollment {
  id: string;
  name: string;
  code: string;
  isPrivate: boolean;
  joinedAt: string;
  members: LeagueMember[];
}

export interface UserRegistryMeta {
  registeredAt: string;
  membershipId: string;
  memberSince: string;
  accountStatus: 'ACTIVE' | 'VERIFIED' | 'SUSPENDED';
  lastLoginAt: string;
  ipRegion: string;
  schemaVersion: number;
}

/**
 * Complete, partitioned User Data Model.
 * Organizes all user sub-data (profile, squad, transfers, leagues, chips, registry)
 * in a centralized and filterable record per user.
 */
export interface UserAccountData {
  id: string;
  profile: UserProfile;
  squad: FantasyTeam;
  ownedPlayerEconomy?: Record<string, OwnedPlayerEconomy>;
  transferHistory: TransferHistoryRecord[];
  leagues: UserLeagueEnrollment[];
  boosters: BoosterChip[];
  registryMeta: UserRegistryMeta;
}
