import { buildResult, type SourceAdapter } from '../adapter.ts';
import { fetchDocument, isLikelyBotBlock } from '../http.ts';
import type { NormalizedEntity, NormalizedMatch, SourceObservation } from '../types.ts';

const DEFAULT_URL = 'https://es.soccerway.com/panama/lpf/';
const BROWSER_USER_AGENT = process.env.SOCCERWAY_USER_AGENT
  ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';

type FeedRecord = Record<string, string>;

/** Extracts Soccerway's server-rendered initial feeds without executing page JavaScript. */
export function extractSoccerwayFeeds(html: string): string[] {
  return [...html.matchAll(/cjs\.initialFeeds\[["'](?:summary-results|summary-fixtures)["']\]\s*=\s*\{[\s\S]*?data:\s*`([\s\S]*?)`/g)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
}

function parseFeedRecords(feed: string): FeedRecord[] {
  return feed.split('¬~AA÷').slice(1).map((raw) => {
    const fields: FeedRecord = {};
    for (const chunk of (`AA÷${raw}`).split('¬')) {
      const separator = chunk.indexOf('÷');
      if (separator > 0) fields[chunk.slice(0, separator)] = chunk.slice(separator + 1);
    }
    return fields;
  });
}

function integer(value: string | undefined): number | null {
  if (!value || !/^-?\d+$/.test(value)) return null;
  return Number(value);
}

export function parseSoccerwayMatches(html: string, sourceUrl: string): NormalizedMatch[] {
  const records = extractSoccerwayFeeds(html).flatMap(parseFeedRecords);
  const candidates = new Map<string, Omit<NormalizedMatch, 'deadlineAt' | 'gameweekStatus'>>();
  for (const record of records) {
    const externalId = record.AA;
    const gameweekNumber = integer(record.ER?.match(/(?:Jornada|Round)\s+(\d+)/i)?.[1]);
    const epochSeconds = integer(record.AD);
    const homeScore = integer(record.AG);
    const awayScore = integer(record.AH);
    if (!externalId || !gameweekNumber || !epochSeconds || !record.AF || !record.AE) continue;
    const completed = record.AB === '3' && homeScore !== null && awayScore !== null;
    const hasScore = homeScore !== null && awayScore !== null;
    candidates.set(externalId, {
      kind: 'match', tournamentId: 'apertura-2026',
      gameweekId: `apertura-2026-gw-${gameweekNumber}`, gameweekNumber,
      scoreStatus: completed ? 'CONFIRMED' : hasScore ? 'PROVISIONAL' : 'PENDING',
      homeClub: record.AF, awayClub: record.AE,
      startsAt: new Date(epochSeconds * 1_000).toISOString(),
      homeScore, awayScore, round: `Jornada ${gameweekNumber}`,
      external: { source: 'SOCCERWAY', externalId, sourceUrl },
    });
  }
  const byGameweek = new Map<number, Array<Omit<NormalizedMatch, 'deadlineAt' | 'gameweekStatus'>>>();
  for (const match of candidates.values()) {
    const matches = byGameweek.get(match.gameweekNumber) ?? [];
    matches.push(match);
    byGameweek.set(match.gameweekNumber, matches);
  }
  const normalized: NormalizedMatch[] = [];
  for (const matches of byGameweek.values()) {
    const deadlineAt = matches.map((match) => match.startsAt).filter((value): value is string => Boolean(value)).sort()[0];
    if (!deadlineAt) continue;
    const gameweekStatus: NormalizedMatch['gameweekStatus'] = matches.every((match) => match.scoreStatus === 'CONFIRMED')
      ? 'FINISHED' : Date.parse(deadlineAt) > Date.now() ? 'OPEN' : 'LIVE';
    normalized.push(...matches.map((match) => ({ ...match, deadlineAt, gameweekStatus })));
  }
  return normalized;
}

export class SoccerwayAdapter implements SourceAdapter {
  readonly source = 'SOCCERWAY' as const;
  readonly parserVersion = 'soccerway-initial-feeds:v1';

  constructor(private readonly url = process.env.SOCCERWAY_LPF_URL ?? DEFAULT_URL) {}

  async collect() {
    const startedAt = new Date().toISOString();
    try {
      const document = await fetchDocument(this.url, { userAgent: BROWSER_USER_AGENT });
      if (isLikelyBotBlock(document.status, document.body)) {
        return buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt, urls: [this.url], httpStatuses: [document.status], blocked: true, errors: [`Soccerway respondió ${document.status} o presentó una barrera anti-bot.`] });
      }
      if (document.status < 200 || document.status >= 300) {
        return buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt, urls: [this.url], httpStatuses: [document.status], errors: [`Soccerway respondió HTTP ${document.status}.`] });
      }
      const matches = parseSoccerwayMatches(document.body, document.url);
      const observations: SourceObservation[] = matches.map((match) => ({
        source: this.source, entityType: 'match', externalEntityId: match.external.externalId,
        sourceUrl: document.url, parserVersion: this.parserVersion, observedAt: document.fetchedAt,
        contentHash: document.contentHash, value: match,
      }));
      const publishCanonical = process.env.SOCCERWAY_PUBLISH_CANONICAL_MATCHES === 'true';
      const warnings = [
        'La página de competición aporta resultados y calendario, pero no actas individuales; no se atribuyen goleadores, asistencias, tarjetas ni minutos.',
        ...(publishCanonical ? [] : ['Los partidos se guardan como observaciones de verificación. Para impedir duplicados, no se publican como canónicos hasta que la reconciliación cruce clubes, jornada y hora.']),
      ];
      if (!matches.length) warnings.unshift('Soccerway respondió, pero sus feeds de resultados y partidos no produjeron registros; posible cambio del HTML.');
      const result = buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt, urls: [document.url], entities: publishCanonical ? matches as NormalizedEntity[] : [], observations, warnings, httpStatuses: [document.status] });
      // Structured observations are usable corroboration even while canonical
      // publication remains gated behind cross-source match reconciliation.
      return matches.length && !publishCanonical ? { ...result, status: 'PARTIAL' as const } : result;
    } catch (error) {
      return buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt, urls: [this.url], errors: [error instanceof Error ? error.message : String(error)] });
    }
  }
}
