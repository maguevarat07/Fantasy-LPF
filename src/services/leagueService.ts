import type { FantasyTeam, LeagueMember } from '../types/fantasy';
import { api, jsonBody } from './apiClient';

export interface LeagueMembershipRecord { userId: string; fantasyTeamId: string; teamName: string; managerName: string; avatarUrl: string; joinedAt: string; }
export interface PrivateLeagueRecord {
  id: string; name: string; code: string; ownerUserId: string; ownerManagerName: string;
  createdAt: string; tournamentId: string; members: LeagueMembershipRecord[]; memberCount?: number;
}

class LeagueService {
  private leagues: PrivateLeagueRecord[] = [];
  async loadUserLeagues(tournamentId: string): Promise<PrivateLeagueRecord[]> {
    const response = await api<{ leagues: PrivateLeagueRecord[] }>(`/leagues?tournamentId=${encodeURIComponent(tournamentId)}`);
    this.leagues = response.leagues.map(league => ({ ...league, members: league.members ?? [] }));
    return [...this.leagues];
  }
  getUserLeagues(_userId?: string): PrivateLeagueRecord[] { return [...this.leagues]; }
  findLeagueByCode(code: string): PrivateLeagueRecord | null {
    const normalized = code.replace(/^#/, '').trim().toUpperCase();
    return this.leagues.find(league => league.code === normalized) ?? null;
  }
  async createLeague(params: { userId?: string; team?: FantasyTeam; managerName?: string; avatarUrl?: string; leagueName: string; tournamentId?: string }): Promise<{ success: boolean; league?: PrivateLeagueRecord; error?: string }> {
    try {
      const response = await api<{ league: PrivateLeagueRecord }>('/leagues', { method: 'POST', ...jsonBody({
        tournamentId: params.tournamentId, name: params.leagueName,
      }) });
      const league = { ...response.league, members: response.league.members ?? [] };
      this.leagues = [...this.leagues.filter(item => item.id !== league.id), league];
      return { success: true, league };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'No se pudo crear la liga.' }; }
  }
  async joinLeague(params: { userId?: string; team?: FantasyTeam; managerName?: string; avatarUrl?: string; code: string }): Promise<{ success: boolean; league?: PrivateLeagueRecord; error?: string }> {
    try {
      const response = await api<{ league: PrivateLeagueRecord }>('/leagues/join', { method: 'POST', ...jsonBody({ code: params.code }) });
      const league = { ...response.league, members: response.league.members ?? [] };
      this.leagues = [...this.leagues.filter(item => item.id !== league.id), league];
      return { success: true, league };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'No se pudo unir a la liga.' }; }
  }
  async leaveLeague(leagueId: string, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try { await api(`/leagues/${leagueId}/membership`, { method: 'DELETE' }); this.leagues = this.leagues.filter(item => item.id !== leagueId); return { success: true }; }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : 'No se pudo abandonar la liga.' }; }
  }
  async getLeaderboard(leagueId: string, currentUserId: string, _teams?: Map<string, FantasyTeam>): Promise<LeagueMember[]> {
    const response = await api<{ leaderboard: Array<{ rank: number; fantasyTeamId: string; teamName: string; managerName: string; totalPoints: number; gameweekPoints: number; bankCents: number; isCurrentUser: number | boolean;
      formation?: FantasyTeam['formation']; starters?: string[]; bench?: string[]; captainId?: string; viceCaptainId?: string }> }>(`/leagues/${leagueId}/leaderboard`);
    return response.leaderboard.map(row => ({
      id: row.fantasyTeamId, position: row.rank, prevPosition: row.rank, teamName: row.teamName,
      managerName: row.managerName, isCurrentUser: Boolean(row.isCurrentUser),
      gwPoints: row.gameweekPoints, totalPoints: row.totalPoints,
      teamValue: 100 - row.bankCents / 100_000_000, avatarUrl: '/player-placeholder.svg',
      formation: row.formation, starters: row.starters ?? [], bench: row.bench ?? [],
      captainId: row.captainId, viceCaptainId: row.viceCaptainId,
    }));
  }
}
export const leagueService = new LeagueService();
