import { createHash } from 'node:crypto';

export interface FetchPolicy {
  timeoutMs?: number;
  attempts?: number;
  minimumDelayMs?: number;
  userAgent?: string;
}

export interface FetchedDocument {
  url: string;
  status: number;
  contentType: string;
  body: string;
  fetchedAt: string;
  contentHash: string;
}

const lastRequestAt = new Map<string, number>();

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function fetchDocument(url: string, policy: FetchPolicy = {}): Promise<FetchedDocument> {
  const parsed = new URL(url);
  const attempts = policy.attempts ?? 3;
  const minimumDelayMs = policy.minimumDelayMs ?? 750;
  const timeoutMs = policy.timeoutMs ?? 15_000;
  const userAgent = policy.userAgent ?? 'FantasyLPFDataBot/1.0 (+responsible server-side ingestion; contact project administrator)';
  const elapsed = Date.now() - (lastRequestAt.get(parsed.host) ?? 0);
  if (elapsed < minimumDelayMs) await wait(minimumDelayMs - elapsed);

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      lastRequestAt.set(parsed.host, Date.now());
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { Accept: 'text/html,application/json;q=0.9,*/*;q=0.5', 'User-Agent': userAgent },
      });
      const body = await response.text();
      return {
        url: response.url,
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        body,
        fetchedAt: new Date().toISOString(),
        contentHash: createHash('sha256').update(body).digest('hex'),
      };
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await wait(500 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Unable to fetch ${url}`);
}

export function isLikelyBotBlock(status: number, body: string): boolean {
  const sample = body.slice(0, 20_000).toLowerCase();
  return status === 401 || status === 403 || status === 429 || /captcha|access denied|cloudflare|verify you are human|robot check/.test(sample);
}
