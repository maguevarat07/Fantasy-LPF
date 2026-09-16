import { buildResult, type SourceAdapter } from '../adapter.js';
import { fetchDocument, isLikelyBotBlock } from '../http.js';
import type { SourceObservation } from '../types.js';

const DEFAULT_PAGE = 'https://www.365scores.com/es/football/league/liga-panamena-5809';
const DEFAULT_FEEDS = [
  'https://webws.365scores.com/web/games/results/?appTypeId=5&langId=1&timezoneName=America%2FPanama&userCountryId=129&competitions=5809',
  'https://webws.365scores.com/web/games/fixtures/?appTypeId=5&langId=1&timezoneName=America%2FPanama&userCountryId=129&competitions=5809',
];
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';

interface Scores365Game {
  id?: number; competitionId?: number; roundNum?: number; startTime?: string; statusGroup?: number; stageName?: string;
  homeCompetitor?: { id?: number; name?: string; score?: number };
  awayCompetitor?: { id?: number; name?: string; score?: number };
}

export interface Scores365MatchSnapshot {
  matchId: string; round: number; startsAt: string; homeClub: string; awayClub: string;
  homeScore: number | null; awayScore: number | null;
  scoreStatus: 'PENDING' | 'PROVISIONAL' | 'CONFIRMED'; sourceUrl: string;
}

export function parse365ScoresGames(payload: unknown, sourceUrl: string): Scores365MatchSnapshot[] {
  const games = (payload as { games?: Scores365Game[] } | null)?.games ?? [];
  return games.flatMap((game): Scores365MatchSnapshot[] => {
    if (!game.id || game.competitionId !== 5809 || !game.roundNum || !game.startTime || !game.homeCompetitor?.name || !game.awayCompetitor?.name) return [];
    const hasScore = Number.isFinite(game.homeCompetitor.score) && Number.isFinite(game.awayCompetitor.score);
    return [{ matchId: String(game.id), round: game.roundNum, startsAt: new Date(game.startTime).toISOString(),
      homeClub: game.homeCompetitor.name, awayClub: game.awayCompetitor.name,
      homeScore: hasScore ? Number(game.homeCompetitor.score) : null,
      awayScore: hasScore ? Number(game.awayCompetitor.score) : null,
      scoreStatus: game.statusGroup === 4 && hasScore ? 'CONFIRMED' : hasScore ? 'PROVISIONAL' : 'PENDING', sourceUrl }];
  });
}

export class Scores365Adapter implements SourceAdapter {
  readonly source = '365SCORES' as const;
  readonly parserVersion = '365scores-webws-games:v1';
  constructor(private readonly pageUrl = process.env.SCORES365_LPF_URL ?? DEFAULT_PAGE, private readonly feedUrls = DEFAULT_FEEDS) {}
  async collect() {
    const startedAt = new Date().toISOString();
    const snapshots = new Map<string, Scores365MatchSnapshot>();
    const errors: string[] = [];
    const statuses: number[] = [];
    for (const url of this.feedUrls) {
      try {
        const document = await fetchDocument(url, { userAgent: USER_AGENT, minimumDelayMs: 1_000 });
        statuses.push(document.status);
        if (isLikelyBotBlock(document.status, document.body) || document.status < 200 || document.status >= 300) { errors.push(`${url}: HTTP ${document.status}.`); continue; }
        for (const snapshot of parse365ScoresGames(JSON.parse(document.body), url)) snapshots.set(snapshot.matchId, snapshot);
      } catch (error) { errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const observedAt = new Date().toISOString();
    const observations: SourceObservation[] = [...snapshots.values()].map(value => ({ source: this.source, entityType: 'match', externalEntityId: value.matchId,
      sourceUrl: value.sourceUrl, parserVersion: this.parserVersion, observedAt,
      contentHash: `${value.matchId}:${value.homeScore ?? ''}:${value.awayScore ?? ''}:${value.scoreStatus}`, value }));
    const result = buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt,
      urls: [this.pageUrl, ...this.feedUrls], observations, errors, httpStatuses: statuses,
      warnings: [`365Scores aportó ${snapshots.size} partidos como evidencia; no reemplaza datos canónicos sin reconciliación.`] });
    return snapshots.size ? { ...result, status: 'PARTIAL' as const } : result;
  }
}
