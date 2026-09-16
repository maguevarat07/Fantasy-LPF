import * as cheerio from 'cheerio';
import { buildResult, type SourceAdapter } from '../adapter.js';
import { fetchDocument, isLikelyBotBlock } from '../http.js';
import { cleanText, normalizeIdentity, normalizePosition, parseNullableInt } from '../normalization.js';
import type { NormalizedClub, NormalizedEntity, NormalizedMatch, NormalizedPlayer, NormalizedPlayerStat, SourceObservation } from '../types.js';

const DEFAULT_COMPETITION_URL = 'https://www.transfermarkt.es/liga-panamena-de-futbol-apertura/startseite/wettbewerb/PN1A/saison_id/2026';
const DEFAULT_IMAGE_URL = 'https://img.a.transfermarkt.technology/portrait/medium/default.jpg?lm=4711';
const BROWSER_USER_AGENT = process.env.TRANSFERMARKT_USER_AGENT
  ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
const CANONICAL_CLUB_NAMES: Record<string, string> = {
  '20960': 'Plaza Amador', '12371': 'Tauro', '18820': 'Alianza',
  '18952': 'Club Deportivo Universitario', '48217': 'Veraguas United F.C.',
  '89061': 'UMECIT F.C.', '1708': 'Sporting', '11698': 'San Francisco',
  '17522': 'Árabe Unido', '28218': 'CAI', '55384': 'Herrera F.C.',
  '91052': 'Unión Coclé FC',
};

function absoluteUrl(value: string | undefined, base: string): string {
  if (!value) return base;
  try { return new URL(value, base).toString(); } catch { return base; }
}

function playerIdFromUrl(value: string): string | null {
  return value.match(/\/spieler\/(\d+)/)?.[1] ?? null;
}

function clubIdFromUrl(value: string): string | null {
  return value.match(/\/verein\/(\d+)/)?.[1] ?? null;
}

function makeSquadUrl(value: string, base: string): string {
  const url = new URL(value, base);
  url.pathname = url.pathname.replace('/startseite/', '/kader/');
  if (!/\/saison_id\/2026\/?$/.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/$/, '')}/saison_id/2026`;
  return url.toString();
}

function matchIdFromUrl(value: string): string | null {
  return value.match(/\/spielbericht\/(\d+)/)?.[1] ?? null;
}

function matchDate(row: cheerio.Cheerio<any>): string | null {
  const rawDate = row.find('td.hide-for-small a[href*="/datum/"]').first().attr('href')?.match(/\/datum\/(\d{4}-\d{2}-\d{2})/)?.[1];
  const rawTime = cleanText(row.find('td.zentriert.hide-for-small').first().text()).match(/\d{2}:\d{2}/)?.[0];
  if (!rawDate || !rawTime) return null;
  // transfermarkt.es publishes this competition in Europe/Madrid local time.
  // Panama is seven hours behind while Madrid is on daylight saving time.
  const [year, month, day] = rawDate.split('-').map(Number);
  const lastSunday = (targetMonth: number) => {
    const lastDay = new Date(Date.UTC(year, targetMonth, 0)).getUTCDate();
    const weekday = new Date(Date.UTC(year, targetMonth - 1, lastDay)).getUTCDay();
    return lastDay - weekday;
  };
  const daylightSaving = month > 3 && month < 10
    || (month === 3 && day >= lastSunday(3))
    || (month === 10 && day < lastSunday(10));
  return new Date(`${rawDate}T${rawTime}:00${daylightSaving ? '+02:00' : '+01:00'}`).toISOString();
}

export class TransfermarktRosterAdapter implements SourceAdapter {
  readonly source = 'TRANSFERMARKT' as const;
  readonly parserVersion = 'transfermarkt-pn1a-2026:v1';

  constructor(private readonly competitionUrl = process.env.TRANSFERMARKT_COMPETITION_URL ?? DEFAULT_COMPETITION_URL) {}

  async collect() {
    const startedAt = new Date().toISOString();
    const urls = [this.competitionUrl];
    const statuses: number[] = [];
    const entities: NormalizedEntity[] = [];
    const observations: SourceObservation[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    try {
      const competition = await fetchDocument(this.competitionUrl, { userAgent: BROWSER_USER_AGENT, minimumDelayMs: 1_250 });
      statuses.push(competition.status);
      if (isLikelyBotBlock(competition.status, competition.body)) {
        return buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt, urls, httpStatuses: statuses, blocked: true, errors: [`Transfermarkt respondió ${competition.status} o presentó una barrera anti-bot.`] });
      }
      if (competition.status < 200 || competition.status >= 300) {
        return buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt, urls, httpStatuses: statuses, errors: [`Transfermarkt respondió HTTP ${competition.status}.`] });
      }
      const $competition = cheerio.load(competition.body);
      const clubs = new Map<string, { club: NormalizedClub; rosterUrl: string }>();
      $competition('a[href*="/startseite/verein/"]').each((_index, element) => {
        const href = $competition(element).attr('href');
        if (!href || !/\/saison_id\/2026\/?$/.test(href)) return;
        const externalId = clubIdFromUrl(href);
        const sourceName = cleanText($competition(element).attr('title') || $competition(element).text());
        if (!externalId || !sourceName || clubs.has(externalId)) return;
        const name = CANONICAL_CLUB_NAMES[externalId] ?? sourceName;
        const sourceUrl = absoluteUrl(href, competition.url);
        clubs.set(externalId, {
          club: { kind: 'club', name, normalizedName: normalizeIdentity(name), external: { source: this.source, externalId, sourceUrl } },
          rosterUrl: makeSquadUrl(href, competition.url),
        });
      });
      for (const [clubExternalId, entry] of clubs) {
        entities.push(entry.club);
        urls.push(entry.rosterUrl);
        const roster = await fetchDocument(entry.rosterUrl, { userAgent: BROWSER_USER_AGENT, minimumDelayMs: 1_250 });
        statuses.push(roster.status);
        if (isLikelyBotBlock(roster.status, roster.body)) { errors.push(`${entry.club.name}: acceso bloqueado con HTTP ${roster.status}.`); continue; }
        if (roster.status < 200 || roster.status >= 300) { errors.push(`${entry.club.name}: HTTP ${roster.status}.`); continue; }
        const $ = cheerio.load(roster.body);
        let playerCount = 0;
        $('table.items > tbody > tr').each((_rowIndex, row) => {
          const playerLink = $(row).find('a[href*="/profil/spieler/"]').first();
          const href = playerLink.attr('href');
          const externalId = href ? playerIdFromUrl(href) : null;
          const fullName = cleanText(playerLink.attr('title') || playerLink.text());
          if (!href || !externalId || !fullName) return;
          const cells = $(row).children('td');
          const identityCell = cells.eq(1);
          const positionText = cleanText(identityCell.find('table.inline-table tr').eq(1).text()) || cleanText(identityCell.text().replace(fullName, ''));
          const portrait = identityCell.find('img.bilderrahmen-fixed').first();
          const imageUrl = absoluteUrl(portrait.attr('data-src') || portrait.attr('src') || DEFAULT_IMAGE_URL, roster.url);
          const nationality = cleanText(cells.eq(3).find('img.flaggenrahmen').attr('title')) || null;
          const sourceUrl = absoluteUrl(href, roster.url);
          const player: NormalizedPlayer = {
            kind: 'player', fullName, displayName: fullName, normalizedName: normalizeIdentity(fullName),
            clubName: entry.club.name, normalizedClubName: entry.club.normalizedName,
            position: normalizePosition(positionText), dateOfBirth: null, nationality,
            shirtNumber: parseNullableInt(cells.eq(0).text()), imageUrl,
            external: { source: this.source, externalId, sourceUrl },
          };
          entities.push(player);
          playerCount += 1;
          observations.push({ source: this.source, entityType: 'registration', externalEntityId: `${clubExternalId}:${externalId}`, sourceUrl: roster.url, parserVersion: this.parserVersion, observedAt: roster.fetchedAt, contentHash: roster.contentHash, value: { tournament: 'apertura-2026', clubExternalId, playerExternalId: externalId, player } });
          const transferTitle = cleanText(identityCell.find('[title^="Nuevo fichaje de:"]').first().attr('title'));
          if (transferTitle) observations.push({ source: this.source, entityType: 'transfer', externalEntityId: `${externalId}:${normalizeIdentity(transferTitle)}`, sourceUrl: roster.url, parserVersion: this.parserVersion, observedAt: roster.fetchedAt, contentHash: roster.contentHash, value: { playerExternalId: externalId, currentClubExternalId: clubExternalId, description: transferTitle } });
        });
        if (!playerCount) errors.push(`${entry.club.name}: la página respondió pero no produjo jugadores; posible cambio del HTML.`);
      }

      const scheduleUrl = this.competitionUrl.replace('/startseite/', '/gesamtspielplan/');
      urls.push(scheduleUrl);
      const schedule = await fetchDocument(scheduleUrl, { userAgent: BROWSER_USER_AGENT, minimumDelayMs: 1_250 });
      statuses.push(schedule.status);
      if (schedule.status < 200 || schedule.status >= 300 || isLikelyBotBlock(schedule.status, schedule.body)) {
        warnings.push(`El calendario de Transfermarkt no pudo verificarse (HTTP ${schedule.status}).`);
      }
      const $schedule = cheerio.load(schedule.status >= 200 && schedule.status < 300 ? schedule.body : '<html></html>');
      const confirmedMatches: NormalizedMatch[] = [];
      $schedule('.box').each((_boxIndex, box) => {
        const roundLabel = cleanText($schedule(box).find('.content-box-headline').first().text());
        const gameweekNumber = Number(roundLabel.match(/^(\d+)\.\s*Jornada/i)?.[1]);
        if (!gameweekNumber) return;
        const parsed: Array<Omit<NormalizedMatch, 'deadlineAt' | 'gameweekStatus'>> = [];
        $schedule(box).find('table tbody > tr').each((_rowIndex, element) => {
          const row = $schedule(element);
          if (row.hasClass('bg_blau_20')) return;
          const report = row.find('a[href*="/spielbericht/"]').first();
          const href = report.attr('href');
          const externalId = href ? matchIdFromUrl(href) : null;
          const clubLinks = row.find('a[href*="/spielplan/verein/"]');
          const homeLink = clubLinks.first();
          const awayLink = clubLinks.last();
          const homeExternalId = clubIdFromUrl(homeLink.attr('href') ?? '');
          const awayExternalId = clubIdFromUrl(awayLink.attr('href') ?? '');
          const homeClub = homeExternalId ? CANONICAL_CLUB_NAMES[homeExternalId] ?? cleanText(homeLink.text()) : '';
          const awayClub = awayExternalId ? CANONICAL_CLUB_NAMES[awayExternalId] ?? cleanText(awayLink.text()) : '';
          const resultText = cleanText(report.text());
          const result = resultText.match(/^(\d+)\s*:\s*(\d+)$/);
          if (!externalId || !homeClub || !awayClub) return;
          parsed.push({ kind: 'match', tournamentId: 'apertura-2026',
            gameweekId: `apertura-2026-gw-${gameweekNumber}`, gameweekNumber,
            scoreStatus: result ? 'CONFIRMED' : 'PENDING', homeClub, awayClub,
            startsAt: matchDate(row), homeScore: result ? Number(result[1]) : null,
            awayScore: result ? Number(result[2]) : null, round: `Jornada ${gameweekNumber}`,
            external: { source: this.source, externalId, sourceUrl: absoluteUrl(href, schedule.url) } } as Omit<NormalizedMatch, 'deadlineAt' | 'gameweekStatus'>);
        });
        const deadlineAt = parsed.map(match => match.startsAt).filter((value): value is string => Boolean(value)).sort()[0];
        if (!deadlineAt || parsed.length === 0) return;
        const allConfirmed = parsed.every(match => match.scoreStatus === 'CONFIRMED');
        const gameweekStatus: NormalizedMatch['gameweekStatus'] = allConfirmed
          ? 'FINISHED' : Date.parse(deadlineAt) > Date.now() ? 'OPEN' : 'LIVE';
        parsed.forEach(match => {
          const complete = { ...match, deadlineAt, gameweekStatus };
          entities.push(complete);
          observations.push({ source: this.source, entityType: 'match', externalEntityId: complete.external.externalId,
            sourceUrl: schedule.url, parserVersion: this.parserVersion, observedAt: schedule.fetchedAt,
            contentHash: schedule.contentHash, value: complete });
          if (complete.scoreStatus === 'CONFIRMED') confirmedMatches.push(complete);
        });
      });
      for (const match of confirmedMatches) {
        urls.push(match.external.sourceUrl);
        const report = await fetchDocument(match.external.sourceUrl, { userAgent: BROWSER_USER_AGENT, minimumDelayMs: 1_250 });
        statuses.push(report.status);
        if (report.status < 200 || report.status >= 300 || isLikelyBotBlock(report.status, report.body)) {
          warnings.push(`${match.round}: no se pudo leer el acta ${match.external.externalId}.`);
          continue;
        }
        const $ = cheerio.load(report.body);
        type MutableStat = { clubName: string | null; starter: boolean; substituteIn: boolean; goals: number; assists: number; yellowCards: number; redCards: number; ownGoals: number };
        const stats = new Map<string, MutableStat>();
        const ensure = (playerId: string, clubName: string | null): MutableStat => {
          const current = stats.get(playerId) ?? { clubName, starter: false, substituteIn: false, goals: 0, assists: 0, yellowCards: 0, redCards: 0, ownGoals: 0 };
          if (!current.clubName && clubName) current.clubName = clubName;
          stats.set(playerId, current);
          return current;
        };
        $('.aufstellung-box').each((_teamIndex, box) => {
          const clubHref = $(box).find('.aufstellung-unterueberschrift-mannschaft a[href*="/verein/"]').first().attr('href') ?? '';
          const clubExternalId = clubIdFromUrl(clubHref);
          const clubName = clubExternalId ? CANONICAL_CLUB_NAMES[clubExternalId] ?? null : null;
          $(box).find('.large-7.aufstellung-vereinsseite a[href*="/profil/spieler/"]').each((_index, link) => {
            const playerId = playerIdFromUrl($(link).attr('href') ?? '');
            if (playerId) ensure(playerId, clubName).starter = true;
          });
          $(box).find('.aufstellung-ersatzbank-box tr').each((_index, row) => {
            const link = $(row).find('a[href*="/profil/spieler/"]').first();
            const playerId = playerIdFromUrl(link.attr('href') ?? '');
            if (playerId && $(row).find('.icon-einwechslung-formation').length) ensure(playerId, clubName).substituteIn = true;
          });
        });
        $('#sb-tore li').each((_index, item) => {
          const action = $(item).find('.sb-aktion-aktion');
          const links = action.find('a[href*="/leistungsdatendetails/spieler/"]');
          const scorerId = playerIdFromUrl(links.first().attr('href') ?? '');
          const clubHref = $(item).find('.sb-aktion-wappen a[href*="/verein/"]').attr('href') ?? '';
          const clubExternalId = clubIdFromUrl(clubHref);
          const clubName = clubExternalId ? CANONICAL_CLUB_NAMES[clubExternalId] ?? null : null;
          if (scorerId) {
            const scorer = ensure(scorerId, clubName);
            if (/propia puerta/i.test(action.text())) scorer.ownGoals += 1; else scorer.goals += 1;
          }
          if (/asistente:/i.test(action.text()) && links.length > 1) {
            const assistantId = playerIdFromUrl(links.eq(1).attr('href') ?? '');
            if (assistantId) ensure(assistantId, clubName).assists += 1;
          }
        });
        $('#sb-karten li').each((_index, item) => {
          const link = $(item).find('a[href*="/leistungsdatendetails/spieler/"]').first();
          const playerId = playerIdFromUrl(link.attr('href') ?? '');
          if (!playerId) return;
          const value = ensure(playerId, null);
          if (/roja|rot/i.test($(item).text())) value.redCards += 1; else value.yellowCards += 1;
        });
        for (const [playerExternalId, value] of stats) {
          const playerStat: NormalizedPlayerStat = { kind: 'player_stat', playerExternalId, matchExternalId: match.external.externalId,
            clubName: value.clubName, starter: value.starter, substituteIn: value.substituteIn, minutes: null,
            goals: value.goals, assists: value.assists, assistStatus: 'CONFIRMED', yellowCards: value.yellowCards,
            redCards: value.redCards, ownGoals: value.ownGoals, saves: null,
            external: { source: this.source, externalId: `${match.external.externalId}:${playerExternalId}`, sourceUrl: match.external.sourceUrl } };
          entities.push(playerStat);
          observations.push({ source: this.source, entityType: 'player_stat', externalEntityId: playerStat.external.externalId,
            sourceUrl: report.url, parserVersion: this.parserVersion, observedAt: report.fetchedAt,
            contentHash: report.contentHash, value: playerStat });
        }
      }
      if (clubs.size !== 12) warnings.push(`La competición expuso ${clubs.size} clubes; se esperaban 12 para declarar cobertura completa.`);
      const playerTotal = entities.filter(entity => entity.kind === 'player').length;
      if (playerTotal < 180) warnings.push(`Solo se detectaron ${playerTotal} jugadores registrados; la carga queda marcada como parcial.`);
      return buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt, urls, entities, observations, warnings, errors, httpStatuses: statuses });
    } catch (error) {
      return buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt, urls, entities, observations, warnings, errors: [...errors, error instanceof Error ? error.message : String(error)], httpStatuses: statuses });
    }
  }
}
