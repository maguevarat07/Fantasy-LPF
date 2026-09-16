import { api } from './apiClient';
import type { Club, Player, Position, SourceObservation, DataSource } from '../types/fantasy';
import { getClubBranding } from '../data/assets';

export interface CompletenessReport {
  clubsDetected: number; totalPlayers: number; activePlayers: number;
  playersByClub: Record<string, number>; playersByPosition: Record<Position, number>;
  playersWithPrice: number; playersWithoutPrice: number; potentialDuplicates: number;
  identityConflicts: number; unresolvedPlayers: number;
  sourcesStatus: Record<DataSource, 'WORKING' | 'PARTIAL' | 'BLOCKED' | 'NOT_VERIFIED'>;
  lastSyncTimestamp: string; status?: string; message?: string;
}

type ApiCatalog = {
  tournament: { id: string; name: string; status: string; budgetCents: number } | null;
  clubs: Array<{ id: string; name: string; code: string; active: number | boolean }>;
  players: Array<{ id: string; name: string; displayName?: string; clubId: string; position: Position; shirtNumber?: number | null; imageUrl?: string | null; priceCents: number; previousPriceCents?: number | null; priceChangeCents?: number | null; priceUpdatedAt?: string | null; pricingVersion?: string | null; status: Player['status']; active: number | boolean;
    totalPoints?: number; recentForm?: number; lastGwPoints?: number; goals?: number; assists?: number;
    cleanSheets?: number; yellowCards?: number; redCards?: number; ownGoals?: number; matchesPlayed?: number;
    priceHistory?: Array<{ gameweekId: string; gameweekName?: string; priceCents: number; changeCents: number; effectiveAt: string }> }>;
  currentGameweek: { id: string; weekNumber?: number; deadlineAt?: string; status?: string } | null;
  completeness: { status: string; clubCount: number; playerCount: number; message: string;
    sourcesStatus?: CompletenessReport['sourcesStatus']; lastSyncTimestamp?: string };
};

export interface ApiMatch {
  id: string; gameweekId: string; homeClubId: string | null; awayClubId: string | null;
  homeClubName: string; awayClubName: string;
  startsAt: string | null; homeScore: number | null; awayScore: number | null;
  round: string | null; scoreStatus: string;
}

class LpfDataService {
  private clubs: Club[] = [];
  private players: Player[] = [];
  private observations: SourceObservation[] = [];
  private catalog: ApiCatalog | null = null;

  async loadCatalog(): Promise<ApiCatalog> {
    const response = await api<ApiCatalog & { success: boolean }>('/catalog');
    this.clubs = response.clubs.map(club => {
      const branding = getClubBranding(club.name, club.code);
      return {
        id: club.id, name: club.name, shortName: branding.code, code: branding.code,
        slug: club.id, city: '', stadium: '', logoUrl: branding.logoUrl,
        active: Boolean(club.active),
      };
    });
    const clubById = new Map(this.clubs.map(club => [club.id, club]));
    this.players = response.players.map(player => {
      const club = clubById.get(player.clubId);
      const currentPrice = player.priceCents / 100_000_000;
      return {
        id: player.id, name: player.name, displayName: player.displayName || player.name,
        clubId: player.clubId, clubCode: club?.code ?? '', clubName: club?.name ?? 'Club sin resolver',
        position: player.position, shirtNumber: player.shirtNumber ?? 0, price: currentPrice, currentPrice,
        previousPrice: player.previousPriceCents == null ? undefined : player.previousPriceCents / 100_000_000,
        priceChange: player.priceChangeCents == null ? undefined : player.priceChangeCents / 100_000_000,
        priceUpdatedAt: player.priceUpdatedAt ?? undefined, pricingVersion: player.pricingVersion ?? undefined,
        priceHistory: player.priceHistory?.map(point => ({
          gameweekId: point.gameweekId, gameweekName: point.gameweekName,
          price: point.priceCents / 100_000_000, change: point.changeCents / 100_000_000,
          effectiveAt: point.effectiveAt,
        })),
        status: player.status, imageUrl: player.imageUrl || '/player-placeholder.svg',
        totalPoints: Number(player.totalPoints ?? 0), recentForm: Number(player.recentForm ?? 0),
        lastGwPoints: Number(player.lastGwPoints ?? 0), goals: Number(player.goals ?? 0),
        assists: Number(player.assists ?? 0), cleanSheets: Number(player.cleanSheets ?? 0),
        yellowCards: Number(player.yellowCards ?? 0), redCards: Number(player.redCards ?? 0),
        ownGoals: Number(player.ownGoals ?? 0), matchesPlayed: Number(player.matchesPlayed ?? 0),
        nextOpponent: 'Por confirmar', nextFdr: 3, historyLast5: [],
      };
    });
    this.catalog = response;
    return response;
  }

  getTournament() { return this.catalog?.tournament ?? null; }
  getCurrentGameweek() { return this.catalog?.currentGameweek ?? null; }
  getClubs(): Club[] { return [...this.clubs]; }
  getAllPlayers(): Player[] { return [...this.players]; }
  getPlayerById(id: string): Player | undefined { return this.players.find(player => player.id === id); }
  getSourceObservations(): SourceObservation[] { return [...this.observations]; }

  async loadMatches(tournamentId: string, gameweekId = 'current'): Promise<ApiMatch[]> {
    const query = new URLSearchParams({ tournamentId, gameweekId });
    const response = await api<{ matches: ApiMatch[] }>(`/matches?${query}`);
    return response.matches;
  }

  async syncCanonicalData(): Promise<CompletenessReport> {
    await this.loadCatalog();
    return this.getCompletenessReport();
  }

  getCompletenessReport(): CompletenessReport {
    const playersByClub: Record<string, number> = {};
    const playersByPosition: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const player of this.players) {
      playersByClub[player.clubName] = (playersByClub[player.clubName] ?? 0) + 1;
      playersByPosition[player.position] += 1;
    }
    return {
      clubsDetected: this.clubs.length, totalPlayers: this.players.length,
      activePlayers: this.players.filter(player => player.status === 'ACTIVE').length,
      playersByClub, playersByPosition,
      playersWithPrice: this.players.filter(player => player.price > 0).length,
      playersWithoutPrice: this.players.filter(player => player.price <= 0).length,
      potentialDuplicates: 0, identityConflicts: 0, unresolvedPlayers: 0,
      sourcesStatus: this.catalog?.completeness.sourcesStatus ?? { LPF: 'NOT_VERIFIED', TRANSFERMARKT: 'NOT_VERIFIED', SOCCERWAY: 'NOT_VERIFIED', '365SCORES': 'NOT_VERIFIED', FOTMOB: 'NOT_VERIFIED' },
      lastSyncTimestamp: this.catalog?.completeness.lastSyncTimestamp ?? '', status: this.catalog?.completeness.status ?? 'EMPTY',
      message: this.catalog?.completeness.message ?? 'Todavía no se ha cargado el catálogo canónico.',
    };
  }
}

export const lpfDataService = new LpfDataService();
