import * as cheerio from 'cheerio';
import { buildResult, type SourceAdapter } from '../adapter.js';
import { fetchDocument, isLikelyBotBlock } from '../http.js';
import type { SourceObservation } from '../types.js';

const DEFAULT_LPF_URL = 'https://www.fotmob.com/leagues/9039/matches/lpf';
const BROWSER_USER_AGENT = process.env.FOTMOB_USER_AGENT
  ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';

interface FotMobTeam { id?: string | number; name?: string; shortName?: string }
interface FotMobMatch {
  id?: string | number; round?: string | number; roundName?: string | number; pageUrl?: string;
  home?: FotMobTeam; away?: FotMobTeam;
  status?: { utcTime?: string; finished?: boolean; started?: boolean; cancelled?: boolean;
    scoreStr?: string; reason?: { short?: string; long?: string } };
}

export interface FotMobMatchSnapshot {
  matchId: string;
  round: string | null;
  startsAt: string | null;
  home: { id: string | null; name: string };
  away: { id: string | null; name: string };
  homeScore: number | null;
  awayScore: number | null;
  state: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'CANCELLED';
  statusText: string | null;
  sourceUrl: string;
}

function nullableString(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text || null;
}

function score(value: string | undefined): [number | null, number | null] {
  const match = value?.match(/^(\d+)\s*-\s*(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : [null, null];
}

/** Parse the public, server-rendered LPF fixture payload without using an undocumented API. */
export function parseFotMobLeaguePage(html: string, pageUrl = DEFAULT_LPF_URL): FotMobMatchSnapshot[] {
  const $ = cheerio.load(html);
  const raw = $('#__NEXT_DATA__').first().text();
  if (!raw) return [];
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return []; }
  const pageProps = (payload as { props?: { pageProps?: {
    fixtures?: { allMatches?: unknown }; matches?: { allMatches?: unknown };
  } } }).props?.pageProps;
  const matches = pageProps?.fixtures?.allMatches ?? pageProps?.matches?.allMatches;
  if (!Array.isArray(matches)) return [];
  return (matches as FotMobMatch[]).flatMap((match) => {
    const matchId = nullableString(match.id);
    const homeName = nullableString(match.home?.name);
    const awayName = nullableString(match.away?.name);
    if (!matchId || !homeName || !awayName) return [];
    const [homeScore, awayScore] = score(match.status?.scoreStr);
    const state: FotMobMatchSnapshot['state'] = match.status?.cancelled ? 'CANCELLED'
      : match.status?.finished ? 'FINISHED' : match.status?.started ? 'LIVE' : 'SCHEDULED';
    let sourceUrl = pageUrl;
    try { if (match.pageUrl) sourceUrl = new URL(match.pageUrl, pageUrl).toString(); } catch { /* keep page URL */ }
    return [{ matchId, round: nullableString(match.roundName ?? match.round),
      startsAt: nullableString(match.status?.utcTime),
      home: { id: nullableString(match.home?.id), name: homeName },
      away: { id: nullableString(match.away?.id), name: awayName }, homeScore, awayScore, state,
      statusText: nullableString(match.status?.reason?.long ?? match.status?.reason?.short), sourceUrl }];
  });
}

export class FotMobAdapter implements SourceAdapter {
  readonly source = 'FOTMOB' as const;
  readonly parserVersion = 'fotmob-lpf-next-data:v2';

  constructor(private readonly leagueUrl = process.env.FOTMOB_LPF_URL ?? DEFAULT_LPF_URL) {}

  async collect() {
    const startedAt = new Date().toISOString();
    const urls = [this.leagueUrl];
    try {
      const document = await fetchDocument(this.leagueUrl, { userAgent: BROWSER_USER_AGENT, minimumDelayMs: 1_000 });
      if (isLikelyBotBlock(document.status, document.body)) {
        return buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt, urls,
          httpStatuses: [document.status], blocked: true, errors: [`FotMob bloqueó la consulta con HTTP ${document.status}.`] });
      }
      if (document.status < 200 || document.status >= 300) {
        return buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt, urls,
          httpStatuses: [document.status], errors: [`FotMob respondió HTTP ${document.status}.`] });
      }
      const snapshots = parseFotMobLeaguePage(document.body, document.url);
      if (!snapshots.length) {
        return buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt, urls,
          httpStatuses: [document.status], errors: ['FotMob respondió, pero __NEXT_DATA__ no produjo partidos LPF.'] });
      }
      const observations: SourceObservation[] = snapshots.map((value) => ({ source: this.source,
        entityType: 'match', externalEntityId: value.matchId, sourceUrl: value.sourceUrl,
        parserVersion: this.parserVersion, observedAt: document.fetchedAt,
        contentHash: document.contentHash, value }));
      const result = buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt, urls,
        observations, httpStatuses: [document.status],
        warnings: [`FotMob aportó ${snapshots.length} partidos como evidencia. No se crean partidos canónicos hasta reconciliar IDs entre fuentes.`] });
      return { ...result, status: 'PARTIAL' as const };
    } catch (error) {
      return buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt, urls,
        errors: [error instanceof Error ? error.message : String(error)] });
    }
  }
}
