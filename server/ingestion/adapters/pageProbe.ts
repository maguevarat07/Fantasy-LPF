import * as cheerio from 'cheerio';
import { buildResult, type SourceAdapter } from '../adapter.js';
import { fetchDocument, isLikelyBotBlock } from '../http.js';
import type { Source, SourceObservation } from '../types.js';

/**
 * A real, deliberately conservative adapter for sources whose public pages are
 * client-rendered or protected. It records a verifiable response observation,
 * but never turns SEO text into players, matches or statistics.
 */
export class PageProbeAdapter implements SourceAdapter {
  constructor(
    readonly source: Source,
    readonly parserVersion: string,
    private readonly urls: string[],
  ) {}

  async collect() {
    const startedAt = new Date().toISOString();
    const observations: SourceObservation[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    const statuses: number[] = [];
    let blocked = false;

    for (const url of this.urls) {
      try {
        const document = await fetchDocument(url);
        statuses.push(document.status);
        if (isLikelyBotBlock(document.status, document.body)) {
          blocked = true;
          errors.push(`${url}: acceso bloqueado (${document.status}).`);
          continue;
        }
        if (document.status < 200 || document.status >= 300) {
          errors.push(`${url}: HTTP ${document.status}.`);
          continue;
        }
        const $ = cheerio.load(document.body);
        const title = $('title').first().text().replace(/\s+/g, ' ').trim();
        observations.push({
          source: this.source,
          entityType: 'source_response',
          externalEntityId: new URL(document.url).pathname,
          sourceUrl: document.url,
          parserVersion: this.parserVersion,
          observedAt: document.fetchedAt,
          contentHash: document.contentHash,
          value: { status: document.status, contentType: document.contentType, title },
        });
      } catch (error) {
        errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (observations.length) warnings.push(`${this.source} respondió, pero este adapter no encontró un contrato público estable para convertir la página en entidades; no se inventaron registros.`);
    return buildResult({ source: this.source, parserVersion: this.parserVersion, startedAt, urls: this.urls, observations, warnings, errors, httpStatuses: statuses, blocked: blocked && observations.length === 0 });
  }
}
