import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type { SqliteDatabase } from '../db.js';

export const INGESTION_JOBS = [
  'syncClubs', 'syncPlayers', 'syncFixtures', 'syncResults',
  'syncMatchDetails', 'syncLineups', 'syncEvents', 'syncPlayerStats',
  'reconcileEntities', 'reconcileEvents',
] as const;

export type IngestionJob = (typeof INGESTION_JOBS)[number];

export interface JobSelection {
  jobs: IngestionJob[];
  sourceUrls?: string[];
}

export interface IngestionScheduler { stop(): void }

// A match is assumed over ~2h10m after kickoff (90 min + halftime + stoppage), so we don't
// poll a source before its own result is even likely to be published yet.
const MATCH_ASSUMED_DURATION_MIN = 130;
// Requested buffer past that assumed end time before syncing for that specific match.
const POST_MATCH_SYNC_BUFFER_MIN = 30;
// Extra safety-net sync anchored to the gameweek's last kickoff, in case a match ran long,
// was postponed, or a source published its result late.
const END_OF_GAMEWEEK_EXTRA_BUFFER_MIN = 150;
const MIN_DELAY_MS = 60 * 1000;

// How often to sync when no gameweek is currently in progress (or every match in the active
// one is already confirmed and its safety-net sync has run). Configurable, defaults to 24h.
function fallbackIntervalMs(): number {
  return Math.max(1, Number(process.env.DATA_SYNC_INTERVAL_HOURS ?? 24)) * 60 * 60 * 1000;
}

/**
 * Picks when the next sync should run. While a gameweek is in progress (i.e. not yet FINISHED),
 * this targets shortly after each of its still-unconfirmed matches, plus one extra end-of-gameweek
 * safety sync — so results show up the same day instead of waiting for the next scheduled sync.
 * Once nothing in the current gameweek still needs syncing (or there's no active gameweek at all),
 * it falls back to a plain 24h cadence.
 */
export function computeNextSyncDelayMs(db: SqliteDatabase, now = Date.now()): number {
  const gameweek = db.prepare(`SELECT id FROM gameweeks WHERE status <> 'FINISHED' ORDER BY week_number ASC LIMIT 1`)
    .get() as { id: string } | undefined;
  if (!gameweek) return fallbackIntervalMs();

  const matches = db.prepare(`SELECT starts_at AS startsAt, score_status AS scoreStatus
    FROM matches WHERE gameweek_id = ? AND starts_at IS NOT NULL`).all(gameweek.id) as
    Array<{ startsAt: string; scoreStatus: string }>;
  if (matches.length === 0) return fallbackIntervalMs();

  const candidates: number[] = [];
  let lastKickoff = 0;
  for (const match of matches) {
    const kickoff = Date.parse(match.startsAt);
    if (Number.isNaN(kickoff)) continue;
    lastKickoff = Math.max(lastKickoff, kickoff);
    if (match.scoreStatus === 'CONFIRMED' || match.scoreStatus === 'CORRECTED') continue;
    candidates.push(kickoff + (MATCH_ASSUMED_DURATION_MIN + POST_MATCH_SYNC_BUFFER_MIN) * 60_000);
  }

  if (lastKickoff > 0) {
    const safetyNetAt = lastKickoff +
      (MATCH_ASSUMED_DURATION_MIN + POST_MATCH_SYNC_BUFFER_MIN + END_OF_GAMEWEEK_EXTRA_BUFFER_MIN) * 60_000;
    const lastSync = db.prepare('SELECT MAX(finished_at) AS t FROM sync_runs').get() as { t: string | null } | undefined;
    const lastSyncAt = lastSync?.t ? Date.parse(lastSync.t) : 0;
    if (lastSyncAt < safetyNetAt) candidates.push(safetyNetAt);
  }

  if (candidates.length === 0) return fallbackIntervalMs();
  return Math.max(MIN_DELAY_MS, Math.min(...candidates) - now);
}

/** Starts the idempotent sync worker only when explicitly enabled. */
export function startIngestionScheduler(db: SqliteDatabase): IngestionScheduler | null {
  if (process.env.ENABLE_DATA_SYNC !== 'true') return null;

  // Spawning node directly against tsx's own CLI file (instead of npm.cmd) avoids Windows'
  // EINVAL when spawning a .cmd/.bat without shell:true, and needs no shell at all.
  const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');

  let running = false;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const child = spawn(process.execPath, [tsxCli, 'scripts/sync-lpf-data.ts'], {
        cwd: process.cwd(), env: process.env, stdio: 'inherit', windowsHide: true,
      });
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', code => code === 0 ? resolve() : reject(new Error(`La sincronización terminó con código ${code}.`)));
      });
    } catch (error) {
      console.error('Falló la sincronización LPF programada:', error);
    } finally {
      running = false;
    }
  };

  const scheduleNext = () => {
    if (stopped) return;
    timer = setTimeout(() => { void run().then(scheduleNext); }, computeNextSyncDelayMs(db));
    timer.unref();
  };

  if (process.env.DATA_SYNC_RUN_ON_START === 'true') void run().then(scheduleNext);
  else scheduleNext();

  return { stop: () => { stopped = true; if (timer) clearTimeout(timer); } };
}
