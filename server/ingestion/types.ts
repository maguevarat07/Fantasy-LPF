export const SOURCES = ['LPF', 'TRANSFERMARKT', 'SOCCERWAY', '365SCORES', 'FOTMOB'] as const;
export type Source = (typeof SOURCES)[number];
export type SourceStatus = 'WORKING' | 'PARTIAL' | 'BLOCKED' | 'NOT_VERIFIED';
export type FantasyPosition = 'GK' | 'DEF' | 'MID' | 'FWD' | null;

export interface ExternalIdentity {
  source: Source;
  externalId: string;
  sourceUrl: string;
}

export interface NormalizedClub {
  kind: 'club';
  name: string;
  normalizedName: string;
  external: ExternalIdentity;
}

export interface NormalizedPlayer {
  kind: 'player';
  fullName: string;
  displayName: string;
  normalizedName: string;
  clubName: string | null;
  normalizedClubName: string | null;
  position: FantasyPosition;
  dateOfBirth: string | null;
  nationality: string | null;
  shirtNumber: number | null;
  imageUrl: string | null;
  external: ExternalIdentity;
}

export interface NormalizedMatch {
  kind: 'match';
  tournamentId: string;
  gameweekId: string;
  gameweekNumber: number;
  gameweekStatus: 'OPEN' | 'LOCKED' | 'LIVE' | 'FINISHED';
  deadlineAt: string;
  scoreStatus: 'PENDING' | 'PROVISIONAL' | 'CONFIRMED' | 'CORRECTED';
  homeClub: string;
  awayClub: string;
  startsAt: string | null;
  homeScore: number | null;
  awayScore: number | null;
  round: string | null;
  external: ExternalIdentity;
}

export interface NormalizedPlayerStat {
  kind: 'player_stat';
  playerExternalId: string;
  matchExternalId: string;
  clubName: string | null;
  starter: boolean | null;
  substituteIn: boolean | null;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  assistStatus?: 'PENDING' | 'PROVISIONAL' | 'CONFIRMED' | 'CORRECTED';
  yellowCards: number | null;
  redCards: number | null;
  ownGoals: number | null;
  saves: number | null;
  external: ExternalIdentity;
}

export interface NormalizedLineupEntry {
  kind: 'lineup';
  matchExternalId: string;
  playerExternalId: string;
  clubExternalId: string | null;
  starter: boolean;
  shirtNumber: number | null;
  external: ExternalIdentity;
}

export type MatchEventType = 'GOAL' | 'ASSIST' | 'YELLOW_CARD' | 'RED_CARD' | 'OWN_GOAL' | 'SUBSTITUTION_IN' | 'SUBSTITUTION_OUT' | 'STARTER';

export interface NormalizedMatchEvent {
  kind: 'match_event';
  matchExternalId: string;
  playerExternalId: string | null;
  relatedPlayerExternalId: string | null;
  clubExternalId: string | null;
  eventType: MatchEventType;
  minute: number | null;
  confirmed: boolean;
  external: ExternalIdentity;
}

export type NormalizedEntity = NormalizedClub | NormalizedPlayer | NormalizedMatch | NormalizedPlayerStat | NormalizedLineupEntry | NormalizedMatchEvent;

export interface SourceObservation {
  source: Source;
  entityType: NormalizedEntity['kind'] | 'source_response' | 'registration' | 'transfer' | 'player_season_stat' | 'verification';
  externalEntityId: string;
  sourceUrl: string;
  parserVersion: string;
  observedAt: string;
  contentHash: string;
  value: unknown;
}

export interface AdapterResult {
  source: Source;
  status: SourceStatus;
  parserVersion: string;
  startedAt: string;
  finishedAt: string;
  sourceUrls: string[];
  entities: NormalizedEntity[];
  observations: SourceObservation[];
  warnings: string[];
  errors: string[];
  httpStatuses: number[];
}

export interface SyncRunRecord {
  runId: string;
  source: Source | 'ALL';
  job: string;
  startedAt: string;
  finishedAt: string;
  status: SourceStatus;
  recordsFound: number;
  recordsCreated: number;
  recordsUpdated: number;
  conflicts: number;
  errors: string[];
}

export interface IdentityConflict {
  entityType: 'player' | 'club' | 'match';
  reason: string;
  candidates: NormalizedEntity[];
}

export interface ReconciliationResult {
  accepted: NormalizedEntity[];
  conflicts: IdentityConflict[];
  potentialDuplicates: Array<{ left: NormalizedEntity; right: NormalizedEntity; reason: string }>;
}

export interface PersistenceResult {
  created: number;
  updated: number;
}

export interface CompletenessReport {
  generatedAt: string;
  clubsDetected: number;
  playersDetected: number;
  activePlayersByClub: Record<string, number>;
  playersWithoutPosition: number;
  playersWithoutClub: number;
  potentialDuplicates: number;
  playersOnlyInOneSource: number;
  identityConflicts: number;
  unresolvedPlayers: number;
  demoPlayersDetected: number | null;
  sourceStatus: Record<Source, SourceStatus>;
  warnings: string[];
}

export interface SyncReport {
  runId: string;
  adapters: AdapterResult[];
  reconciliation: ReconciliationResult;
  persistence: PersistenceResult;
  completeness: CompletenessReport;
  verification: DataVerificationReport;
}

export interface MatchVerificationClaim {
  source: Source;
  externalId: string;
  sourceUrl: string;
  homeClub: string;
  awayClub: string;
  startsAt: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
}

export interface MatchVerificationGroup {
  key: string;
  claims: MatchVerificationClaim[];
  verdict: 'AGREEMENT' | 'CONFLICT' | 'SINGLE_SOURCE';
}

export interface DataVerificationReport {
  generatedAt: string;
  matchClaimsBySource: Partial<Record<Source, number>>;
  agreements: number;
  conflicts: number;
  singleSource: number;
  groups: MatchVerificationGroup[];
  playerTotalClaimsBySource: Partial<Record<Source, number>>;
  playerTotalsCompared: number;
  playerFieldAgreements: number;
  playerFieldDifferences: number;
}
