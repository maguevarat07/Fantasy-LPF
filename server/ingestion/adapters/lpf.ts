import * as cheerio from 'cheerio';
import { buildResult, type SourceAdapter } from '../adapter.js';
import { fetchDocument, isLikelyBotBlock } from '../http.js';
import { cleanText, normalizeIdentity, normalizePosition, parseNullableInt, stableFallbackId } from '../normalization.js';
import type { NormalizedClub, NormalizedEntity, NormalizedPlayer, SourceObservation } from '../types.js';

const DEFAULT_URL = 'https://lpf.com.pa/list/plantilla/';
const OFFICIAL_LPF_ROSTER_URLS = [
  'https://lpf.com.pa/list/alianza/',
  'https://lpf.com.pa/team/arabe-unido/plantilla/',
  'https://lpf.com.pa/list/sporting/',
  'https://lpf.com.pa/list/tauro/',
  'https://lpf.com.pa/list/umecit-fc/',
  'https://lpf.com.pa/list/plazaamador/',
  'https://lpf.com.pa/list/cai/',
  'https://lpf.com.pa/list/deportivouniversitario/',
  'https://lpf.com.pa/list/sanfrancisco/',
  'https://lpf.com.pa/list/herrera/',
  'https://lpf.com.pa/team/veraguas-united/plantilla/',
  'https://lpf.com.pa/team/cocle-fc/plantilla/',
];

function findColumn(headers: string[], candidates: RegExp[]): number {
  return headers.findIndex((header) => candidates.some((candidate) => candidate.test(normalizeIdentity(header))));
}

export interface LpfPublishedTotals {
  goals: number | null;
  assists: number | null;
  yellowCards: number | null;
  redCards: number | null;
}

/** LPF publishes these as page-level cumulative totals, without a match or tournament id. */
export function parseLpfPublishedTotals(headers: string[], cells: string[]): LpfPublishedTotals | null {
  const read = (patterns: RegExp[]) => {
    const index = findColumn(headers, patterns);
    return index < 0 ? null : parseNullableInt(cells[index] ?? '');
  };
  const totals = {
    goals: read([/^goles?$/, /^goals?$/]),
    assists: read([/^asistencias?$/, /^assists?$/]),
    yellowCards: read([/tarjetas? amarillas?/, /yellow cards?/]),
    redCards: read([/tarjetas? rojas?/, /red cards?/]),
  };
  return Object.values(totals).every(value => value === null) ? null : totals;
}

function absolutize(href: string | undefined, baseUrl: string): string {
  if (!href) return baseUrl;
  try { return new URL(href, baseUrl).toString(); } catch { return baseUrl; }
}

function idFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const queryId = parsed.searchParams.get('player') ?? parsed.searchParams.get('id');
    if (queryId) return queryId;
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts.at(-1) ?? null;
  } catch { return null; }
}

export class LpfAdapter implements SourceAdapter {
  readonly source = 'LPF' as const;
  readonly parserVersion = 'lpf-roster-table:v1';

  constructor(private readonly rosterUrl = process.env.LPF_ROSTER_URL ?? DEFAULT_URL) {}

  async collect() {
    const startedAt = new Date().toISOString();
    try {
      const document = await fetchDocument(this.rosterUrl);
      if (isLikelyBotBlock(document.status, document.body)) {
        return buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt, urls: [this.rosterUrl], httpStatuses: [document.status], blocked: true, errors: [`LPF respondió ${document.status} o presentó una barrera anti-bot.`] });
      }
      if (document.status < 200 || document.status >= 300) {
        return buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt, urls: [this.rosterUrl], httpStatuses: [document.status], errors: [`LPF respondió HTTP ${document.status}.`] });
      }

      const $ = cheerio.load(document.body);
      const pathname = new URL(document.url).pathname;
      const isTeamRoster = /\/team\/[^/]+\/plantilla\/?$/i.test(pathname)
        || /^\/list\/(?!plantilla\/?$)[^/]+\/?$/i.test(pathname);
      const rosterClubName = isTeamRoster
        ? cleanText($('.team-name, .sp-team-name, h1.entry-title, h1').first().text()) || null
        : null;
      const entities: NormalizedEntity[] = [];
      const observations: SourceObservation[] = [];
      const clubs = new Map<string, NormalizedClub>();
      const seenPlayers = new Set<string>();

      $('table').each((_tableIndex, table) => {
        const headers = $(table).find('thead th').map((_index, cell) => cleanText($(cell).text())).get();
        const nameIndex = findColumn(headers, [/^jugador$/, /^player$/, /^nombre$/]);
        if (nameIndex < 0) return;
        const clubIndex = findColumn(headers, [/^club$/, /^equipo$/]);
        const positionIndex = findColumn(headers, [/posicion/, /^pos$/]);
        // A generic "Fecha" column on LPF pages is often the publication date,
        // not the player's birth date. Never use it as an identity attribute.
        const birthIndex = findColumn(headers, [/nacimiento/, /date of birth/]);
        const numberIndex = findColumn(headers, [/dorsal/, /^numero$/, /^#$/]);

        $(table).find('tbody tr').each((_rowIndex, row) => {
          const cells = $(row).find('td');
          if (cells.length <= nameIndex) return;
          const nameCell = cells.eq(nameIndex);
          const fullName = cleanText(nameCell.text());
          if (!fullName) return;
          const rawClubName = clubIndex >= 0 ? cleanText(cells.eq(clubIndex).text()) : '';
          const clubName = rawClubName && rawClubName !== '-' ? rawClubName : rosterClubName;
          const sourceUrl = absolutize(nameCell.find('a').first().attr('href'), document.url);
          const externalId = idFromUrl(sourceUrl) ?? stableFallbackId(fullName, clubName);
          if (!externalId || seenPlayers.has(externalId)) return;
          seenPlayers.add(externalId);
          const player: NormalizedPlayer = {
            kind: 'player', fullName, displayName: fullName, normalizedName: normalizeIdentity(fullName),
            clubName, normalizedClubName: clubName ? normalizeIdentity(clubName) : null,
            position: positionIndex >= 0 ? normalizePosition(cells.eq(positionIndex).text()) : null,
            dateOfBirth: birthIndex >= 0 && Number.isFinite(Date.parse(cleanText(cells.eq(birthIndex).text())))
              ? new Date(cleanText(cells.eq(birthIndex).text())).toISOString().slice(0, 10) : null,
            nationality: null, shirtNumber: numberIndex >= 0 ? parseNullableInt(cells.eq(numberIndex).text()) : null,
            imageUrl: nameCell.find('img').attr('src') ? absolutize(nameCell.find('img').attr('src'), document.url) : null,
            external: { source: this.source, externalId, sourceUrl },
          };
          entities.push(player);
          observations.push({ source: this.source, entityType: 'player', externalEntityId: externalId, sourceUrl, parserVersion: this.parserVersion, observedAt: document.fetchedAt, contentHash: document.contentHash, value: player });
          const publishedTotals = parseLpfPublishedTotals(headers, cells.map((_index, cell) => cleanText($(cell).text())).get());
          if (publishedTotals) observations.push({
            source: this.source,
            entityType: 'player_season_stat',
            externalEntityId: externalId,
            sourceUrl,
            parserVersion: this.parserVersion,
            observedAt: document.fetchedAt,
            contentHash: document.contentHash,
            value: {
              playerExternalId: externalId,
              playerName: fullName,
              normalizedPlayerName: player.normalizedName,
              clubName,
              normalizedClubName: player.normalizedClubName,
              totals: publishedTotals,
              scope: 'LPF_PAGE_CUMULATIVE_UNSCOPED',
              authoritativeForFantasyPoints: false,
            },
          });
          if (clubName) {
            const normalizedName = normalizeIdentity(clubName);
            if (!clubs.has(normalizedName)) clubs.set(normalizedName, { kind: 'club', name: clubName, normalizedName, external: { source: this.source, externalId: stableFallbackId('club', clubName), sourceUrl: document.url } });
          }
        });
      });
      entities.unshift(...clubs.values());
      const warnings: string[] = [];
      const players = entities.filter((entity) => entity.kind === 'player');
      if (!players.length) warnings.push('La página respondió, pero ningún jugador coincidió con la tabla de plantilla esperada; se considera un posible cambio de parser.');
      if (players.some((player) => player.kind === 'player' && !player.clubName)) warnings.push('LPF no expuso club para uno o más jugadores en la tabla obtenida.');
      if (!isTeamRoster) warnings.push('La lista global de LPF no acredita por sí sola inscripción en el torneo activo; los jugadores sin club quedan sin resolver y no deben activarse automáticamente. Configure LPF_ROSTER_URL con una página oficial /team/.../plantilla/ por ejecución para acreditar una plantilla concreta.');
      if (isTeamRoster) warnings.push('La página oficial del club no expone un identificador de torneo; antes de habilitar estos jugadores en el mercado, el backend debe asociar esta ejecución al torneo activo configurado.');
      return buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt, urls: [document.url], entities, observations, warnings, httpStatuses: [document.status] });
    } catch (error) {
      return buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt, urls: [this.rosterUrl], errors: [error instanceof Error ? error.message : String(error)] });
    }
  }
}

export class LpfRosterAdapter implements SourceAdapter {
  readonly source = 'LPF' as const;
  readonly parserVersion = 'lpf-roster-collection:v1';
  private readonly urls: string[];

  constructor(urls?: string[]) {
    const configured = process.env.LPF_ROSTER_URLS ?? process.env.LPF_ROSTER_URL;
    this.urls = urls?.length ? urls : configured
      ? configured.split(',').map((url) => url.trim()).filter(Boolean)
      : OFFICIAL_LPF_ROSTER_URLS;
  }

  async collect() {
    const startedAt = new Date().toISOString();
    const results = [];
    for (const url of this.urls) results.push(await new LpfAdapter(url).collect());
    return buildResult({
      source: this.source,
      parserVersion: this.parserVersion,
      startedAt,
      urls: results.flatMap((result) => result.sourceUrls),
      entities: results.flatMap((result) => result.entities),
      observations: results.flatMap((result) => result.observations),
      warnings: results.flatMap((result) => result.warnings),
      errors: results.flatMap((result) => result.errors),
      httpStatuses: results.flatMap((result) => result.httpStatuses),
      blocked: results.length > 0 && results.every((result) => result.status === 'BLOCKED'),
    });
  }
}
