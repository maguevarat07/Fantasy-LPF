import type { UserAccountData, UserProfile, FantasyTeam, TransferHistoryRecord, BoosterChip, LeagueMember, Formation, ChipId } from '../types/fantasy';
import type { AuthUser } from './authService';
import { api, jsonBody } from './apiClient';

export const DEFAULT_USER_ID = '';

const DEFAULT_BOOSTERS: BoosterChip[] = [
  { id: 'wildcard', name: 'Comodín LPF', badge: '1 por torneo', state: 'AVAILABLE', stateLabel: 'Disponible', description: 'Transferencias sin penalización durante una jornada.' },
  { id: 'triple_cap', name: 'Triple Capitán', badge: 'Bloqueado', state: 'LOCKED', stateLabel: 'Bloqueado', description: 'Triplica los puntos del capitán.', lockedReason: 'Pendiente de habilitación oficial.' },
  { id: 'bench_boost', name: 'Banquillo Potenciado', badge: 'Bloqueado', state: 'LOCKED', stateLabel: 'Bloqueado', description: 'Suma los puntos del banquillo.', lockedReason: 'Pendiente de habilitación oficial.' },
  { id: 'emergency_fund', name: 'Fondo de Emergencia', badge: 'Bloqueado', state: 'LOCKED', stateLabel: 'Bloqueado', description: 'Presupuesto extraordinario.', lockedReason: 'Pendiente de habilitación oficial.' },
];

type ApiTeam = {
  id: string; tournamentId: string; name: string; formation: Formation; bankCents: number;
  totalPoints: number; gameweekPoints: number; freeTransfers: number; transferPenaltyPoints: number;
  squad: Array<{ id: string; currentPriceCents?: number | null; purchasePriceCents?: number | null;
    sellingPriceCents?: number | null; priceChangeCents?: number | null;
    profitLossCents?: number | null; purchaseGameweekId?: string | null }>;
  economy?: { currentMarketValueCents: number; sellingSquadValueCents: number;
    bankCents: number; totalAvailableValueCents: number };
  transferHistory?: TransferHistoryRecord[];
  lineup: null | { gameweekId: string; formation: Formation; captainId: string; viceCaptainId: string; players: Array<{ playerId: string; role: 'STARTER' | 'BENCH'; slot: number }> };
};

export const createNewUserAccount = (user: AuthUser, teamName?: string): UserAccountData => ({
  id: user.id,
  profile: {
    id: user.id, username: `@${user.username}`, managerName: user.name,
    teamName: teamName || `${user.name.split(' ')[0]} FC`, email: user.email, phone: user.phone || '', province: user.province || '',
    favoriteClubId: user.favoriteClubId || '', membershipId: user.id.slice(0, 8).toUpperCase(),
    memberSince: new Date(user.createdAt).toLocaleDateString('es-PA', { month: 'short', year: 'numeric' }),
    avatarUrl: user.avatarUrl || '', notificationsEnabled: true, emailAlertsEnabled: true,
  },
  squad: {
    id: '', name: teamName || `${user.name.split(' ')[0]} FC`, managerName: user.name,
    totalBudget: 100, budgetRemaining: 100, totalPoints: 0, lastGwPoints: 0,
    rankGlobal: 0, rankTotalManagers: 0, formation: '4-3-3', starters: [], bench: [],
    captainId: '', viceCaptainId: '', freeTransfers: 1, transfersBanked: 0,
    transferPenaltyPoints: 0, comodinAvailable: true, comodinActiveInGw: false,
    activeChip: null, masteryXp: 0,
  },
  transferHistory: [], leagues: [],
  boosters: DEFAULT_BOOSTERS.map(item => ({ ...item })),
  registryMeta: {
    registeredAt: user.createdAt, membershipId: user.id.slice(0, 8).toUpperCase(),
    memberSince: 'Torneo vigente', accountStatus: 'ACTIVE', lastLoginAt: new Date().toISOString(),
    ipRegion: '', schemaVersion: 3,
  },
});

function applyApiTeam(account: UserAccountData, value: ApiTeam): UserAccountData {
  const lineupPlayers = value.lineup?.players ?? [];
  const starters = lineupPlayers.filter(player => player.role === 'STARTER').sort((a, b) => a.slot - b.slot).map(player => player.playerId);
  const bench = lineupPlayers.filter(player => player.role === 'BENCH').sort((a, b) => a.slot - b.slot).map(player => player.playerId);
  return {
    ...account,
    ownedPlayerEconomy: Object.fromEntries(value.squad.map(player => [player.id, {
      playerId: player.id,
      currentPrice: player.currentPriceCents == null ? undefined : player.currentPriceCents / 100_000_000,
      purchasePrice: player.purchasePriceCents == null ? undefined : player.purchasePriceCents / 100_000_000,
      sellingPrice: player.sellingPriceCents == null ? undefined : player.sellingPriceCents / 100_000_000,
      priceChange: player.priceChangeCents == null ? undefined : player.priceChangeCents / 100_000_000,
      profitLoss: player.profitLossCents == null ? undefined : player.profitLossCents / 100_000_000,
      purchaseGameweek: player.purchaseGameweekId ?? undefined,
    }])),
    transferHistory: value.transferHistory ?? account.transferHistory,
    profile: { ...account.profile, teamName: value.name },
    squad: {
      ...account.squad, id: value.id, name: value.name, formation: value.formation,
      budgetRemaining: value.bankCents / 100_000_000, totalPoints: value.totalPoints,
      currentMarketValue: value.economy?.currentMarketValueCents == null ? undefined : value.economy.currentMarketValueCents / 100_000_000,
      sellingSquadValue: value.economy?.sellingSquadValueCents == null ? undefined : value.economy.sellingSquadValueCents / 100_000_000,
      totalAvailableValue: value.economy?.totalAvailableValueCents == null ? undefined : value.economy.totalAvailableValueCents / 100_000_000,
      lastGwPoints: value.gameweekPoints, freeTransfers: value.freeTransfers,
      transferPenaltyPoints: value.transferPenaltyPoints, starters, bench,
      captainId: value.lineup?.captainId ?? '', viceCaptainId: value.lineup?.viceCaptainId ?? '',
    },
  };
}

class UserDatabaseService {
  private account: UserAccountData | null = null;
  private tournamentId = '';
  getUserAccount(userId?: string): UserAccountData {
    if (!this.account || (userId && this.account.id !== userId)) throw new Error('La cuenta todavía no se ha cargado.');
    return this.account;
  }
  hasUserAccount(userId: string): boolean { return this.account?.id === userId; }
  getOrCreateUserAccount(user: AuthUser): UserAccountData {
    if (!this.account || this.account.id !== user.id) this.account = createNewUserAccount(user);
    return this.account;
  }
  clear(): void { this.account = null; }
  isUserOnboardingComplete(userId: string): boolean {
    if (!this.account || this.account.id !== userId) return false;
    return this.account.squad.starters.length === 11 && this.account.squad.bench.length === 4 &&
      Boolean(this.account.squad.captainId) && Boolean(this.account.squad.viceCaptainId);
  }

  async loadUserAccount(user: AuthUser, tournamentId: string, gameweekId?: string): Promise<UserAccountData> {
    this.tournamentId = tournamentId;
    let account = createNewUserAccount(user);
    const query = new URLSearchParams({ tournamentId });
    if (gameweekId) query.set('gameweekId', gameweekId);
    const response = await api<{ team: ApiTeam | null }>(`/team?${query}`);
    if (response.team) account = applyApiTeam(account, response.team);
    this.account = account;
    return account;
  }

  async loadOnboardingDraft(tournamentId: string): Promise<{
    step: number; teamName: string; province: string; favoriteClubId: string; formation: Formation;
    selectedPlayerIds: string[]; starters: string[]; bench: string[]; captainId: string; viceCaptainId: string;
  } | null> {
    const response = await api<{ draft: null | {
      step: number; teamName: string; province: string; favoriteClubId: string; formation: Formation;
      selectedPlayerIds: string[]; starters: string[]; bench: string[]; captainId: string; viceCaptainId: string;
    } }>(`/onboarding/draft?tournamentId=${encodeURIComponent(tournamentId)}`);
    return response.draft;
  }

  async saveOnboardingDraft(value: {
    tournamentId: string; step: number; teamName: string; province: string; favoriteClubId: string;
    formation: Formation; selectedPlayerIds: string[]; starters: string[]; bench: string[];
    captainId: string; viceCaptainId: string;
  }): Promise<void> {
    await api('/onboarding/draft', { method: 'PUT', ...jsonBody(value) });
  }

  async loadGameState(tournamentId: string, gameweekId?: string): Promise<UserAccountData> {
    if (!this.account) throw new Error('Cuenta no cargada.');
    const query = new URLSearchParams({ tournamentId });
    if (gameweekId) query.set('gameweekId', gameweekId);
    const response = await api<{ chips: Array<{ chipId: ChipId; unlockedAt: string | null; activeGameweekId: string | null; usedGameweekId: string | null }>;
      rewards: { masteryXp: number; tacticalCoins: number } }>(`/game-state?${query}`);
    const active = response.chips.find(chip => chip.activeGameweekId)?.chipId ?? null;
    this.account = { ...this.account, squad: { ...this.account.squad,
      activeChip: active, comodinAvailable: !response.chips.some(chip => chip.chipId === 'wildcard' && chip.usedGameweekId),
      comodinActiveInGw: active === 'wildcard', tripleCaptainActiveInGw: active === 'triple_cap',
      benchBoostActiveInGw: active === 'bench_boost', emergencyFundActiveInGw: active === 'emergency_fund',
      unlockedChips: response.chips.filter(chip => chip.unlockedAt).map(chip => chip.chipId),
      usedChips: Object.fromEntries(response.chips.filter(chip => chip.usedGameweekId).map(chip => [chip.chipId, chip.usedGameweekId!])),
      masteryXp: response.rewards.masteryXp,
    } };
    return this.account;
  }

  async setActiveChip(tournamentId: string, gameweekId: string, chipId: ChipId, active: boolean): Promise<UserAccountData> {
    if (!this.account) throw new Error('Cuenta no cargada.');
    await api(`/chips/${active ? 'activate' : 'deactivate'}`, { method: 'POST', ...jsonBody({ tournamentId, gameweekId, chipId }) });
    return this.loadGameState(tournamentId, gameweekId);
  }

  async completeUserOnboarding(params: {
    userId: string; tournamentId: string; gameweekId: string; teamName: string; province: string;
    favoriteClubId: string; formation: Formation; starters: string[]; bench: string[];
    captainId: string; viceCaptainId: string; budgetRemaining?: number;
  }): Promise<{ success: boolean; account?: UserAccountData; error?: string }> {
    try {
      if (!this.account || this.account.id !== params.userId) throw new Error('Cuenta no cargada.');
      const response = await api<{ team: ApiTeam }>('/onboarding', { method: 'POST', ...jsonBody({
        tournamentId: params.tournamentId, gameweekId: params.gameweekId, teamName: params.teamName,
        province: params.province, favoriteClubId: params.favoriteClubId, formation: params.formation,
        starters: params.starters, bench: params.bench, captainId: params.captainId, viceCaptainId: params.viceCaptainId,
      }) });
      this.account = applyApiTeam(this.account, response.team);
      this.account.profile.province = params.province;
      this.account.profile.favoriteClubId = params.favoriteClubId;
      return { success: true, account: this.account };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'No se pudo confirmar la plantilla.' };
    }
  }

  async updateUserProfile(userId: string, updated: Partial<UserProfile>): Promise<UserAccountData> {
    if (!this.account || this.account.id !== userId) throw new Error('Cuenta no cargada.');
    await api('/profile', { method: 'PATCH', ...jsonBody({
      email: updated.email, username: updated.username?.replace(/^@/, ''), teamName: updated.teamName,
      tournamentId: this.tournamentId, phone: updated.phone,
      managerName: updated.managerName, province: updated.province,
      favoriteClubId: updated.favoriteClubId || null, avatarUrl: updated.avatarUrl || '',
      notificationsEnabled: updated.notificationsEnabled, emailAlertsEnabled: updated.emailAlertsEnabled,
    }) });
    this.account = { ...this.account, profile: { ...this.account.profile, ...updated },
      squad: { ...this.account.squad, name: updated.teamName ?? this.account.squad.name, managerName: updated.managerName ?? this.account.squad.managerName } };
    return this.account;
  }

  async updateUserSquad(userId: string, updated: Partial<FantasyTeam>, tournamentId: string, gameweekId: string): Promise<UserAccountData> {
    if (!this.account || this.account.id !== userId) throw new Error('Cuenta no cargada.');
    const next = { ...this.account.squad, ...updated };
    if (next.starters.length === 11 && next.bench.length === 4 && next.captainId && next.viceCaptainId) {
      const response = await api<{ team: ApiTeam }>('/team/lineup', { method: 'PUT', ...jsonBody({
        tournamentId, gameweekId, formation: next.formation, starters: next.starters, bench: next.bench,
        captainId: next.captainId, viceCaptainId: next.viceCaptainId,
      }) });
      this.account = applyApiTeam(this.account, response.team);
    }
    return this.account;
  }

  async executeTransfer(userId: string, tournamentId: string, gameweekId: string,
    playerOutId: string, playerInId: string, expectedBuyPriceCents: number,
    expectedSellPriceCents: number): Promise<UserAccountData> {
    if (!this.account || this.account.id !== userId) throw new Error('Cuenta no cargada.');
    const response = await api<{ team: ApiTeam }>('/transfers', { method: 'POST', ...jsonBody({
      tournamentId, gameweekId, items: [{ playerOutId, playerInId,
        expectedBuyPriceCents, expectedSellPriceCents }],
    }) });
    this.account = applyApiTeam(this.account, response.team);
    return this.account;
  }

  addUserTransfer(_userId: string, record: TransferHistoryRecord): UserAccountData {
    if (!this.account) throw new Error('Cuenta no cargada.');
    this.account = { ...this.account, transferHistory: [record, ...this.account.transferHistory] };
    return this.account;
  }
  updateUserBoosters(_userId: string, boosters: BoosterChip[]): UserAccountData {
    if (!this.account) throw new Error('Cuenta no cargada.');
    this.account = { ...this.account, boosters: [...boosters] }; return this.account;
  }
  updateUserLeagueMembers(_userId: string, leagueId: string, members: LeagueMember[]): UserAccountData {
    if (!this.account) throw new Error('Cuenta no cargada.');
    this.account = { ...this.account, leagues: this.account.leagues.map(league => league.id === leagueId ? { ...league, members } : league) };
    return this.account;
  }
  getAllTeamsMap(): Map<string, FantasyTeam> {
    return this.account ? new Map([[this.account.id, this.account.squad]]) : new Map();
  }
}

export const userDatabase = new UserDatabaseService();
