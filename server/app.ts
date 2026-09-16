import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import { openDatabase, type SqliteDatabase } from './db.js';
import { applicationDatabase, type ApplicationDatabase } from './applicationDatabase.js';
import type { PostgresDatabase } from './postgres/client.js';
import {
  FORMATIONS,
  TeamRuleError,
  loadTournamentPlayers,
  validateLineup,
  validateSquad,
} from './teamRules.js';
import { ownershipPriceQuote } from './marketEconomy.js';

const SESSION_COOKIE = 'fantasy_lpf_session';
const SESSION_DAYS = 30;
const POSITION = z.enum(['GK', 'DEF', 'MID', 'FWD']);
const FORMATION = z.enum(Object.keys(FORMATIONS) as [string, ...string[]]);

const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().min(10).max(128),
  managerName: z.string().trim().min(2).max(80),
}).strict();

const loginSchema = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(128),
}).strict();

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(10).max(128),
}).strict();

const profileSchema = z.object({
  email: z.string().trim().email().max(254).optional(),
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_.-]+$/).optional(),
  teamName: z.string().trim().min(3).max(60).optional(),
  tournamentId: z.string().trim().min(1).max(100).optional(),
  managerName: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().max(30).optional(),
  province: z.string().trim().min(2).max(80).optional(),
  favoriteClubId: z.string().trim().min(1).max(80).nullable().optional(),
  // Accommodates a base64 data: URI from an uploaded photo (client caps raw files at 5MB,
  // which becomes ~6.7MB once base64-encoded), not just a short external image URL.
  avatarUrl: z.union([z.string().trim().url().max(8_000_000), z.literal('')]).optional(),
  notificationsEnabled: z.boolean().optional(),
  emailAlertsEnabled: z.boolean().optional(),
}).strict()
  .refine(value => Object.keys(value).length > 0, 'No hay cambios para guardar.')
  .refine(value => !value.teamName || Boolean(value.tournamentId), 'El torneo es obligatorio para renombrar el equipo.');

const lineupFields = {
  formation: FORMATION,
  gameweekId: z.string().trim().min(1).max(80),
  starters: z.array(z.string().trim().min(1).max(100)).length(11),
  bench: z.array(z.string().trim().min(1).max(100)).length(4),
  captainId: z.string().trim().min(1).max(100),
  viceCaptainId: z.string().trim().min(1).max(100),
};

const onboardingSchema = z.object({
  tournamentId: z.string().trim().min(1).max(100),
  teamName: z.string().trim().min(3).max(60),
  province: z.string().trim().min(2).max(80).optional(),
  favoriteClubId: z.string().trim().min(1).max(80).nullable().optional(),
  ...lineupFields,
}).strict();

const lineupSchema = z.object({
  tournamentId: z.string().trim().min(1).max(100),
  ...lineupFields,
}).strict();

const createLeagueSchema = z.object({
  tournamentId: z.string().trim().min(1).max(100),
  name: z.string().trim().min(3).max(80),
}).strict();

const joinLeagueSchema = z.object({ code: z.string().trim().regex(/^#?[A-Za-z2-9]{6}$/) }).strict();

const transferSchema = z.object({
  tournamentId: z.string().trim().min(1).max(100),
  gameweekId: z.string().trim().min(1).max(80),
  items: z.array(z.object({
    playerOutId: z.string().trim().min(1).max(100),
    playerInId: z.string().trim().min(1).max(100),
    expectedBuyPriceCents: z.number().int().nonnegative().optional(),
    expectedSellPriceCents: z.number().int().nonnegative().optional(),
  }).strict()).min(1).max(15),
}).strict();

const onboardingDraftSchema = z.object({
  tournamentId: z.string().trim().min(1).max(100),
  step: z.number().int().min(1).max(6),
  teamName: z.string().trim().max(60).optional().default(''),
  province: z.string().trim().max(80).optional().default(''),
  favoriteClubId: z.string().trim().max(80).nullable().optional(),
  formation: FORMATION.optional().default('4-3-3'),
  selectedPlayerIds: z.array(z.string().trim().min(1).max(100)).max(15).optional().default([]),
  starters: z.array(z.string().trim().min(1).max(100)).max(11).optional().default([]),
  bench: z.array(z.string().trim().min(1).max(100)).max(4).optional().default([]),
  captainId: z.string().trim().max(100).optional().default(''),
  viceCaptainId: z.string().trim().max(100).optional().default(''),
}).strict();

const chipSchema = z.object({
  tournamentId: z.string().trim().min(1).max(100),
  gameweekId: z.string().trim().min(1).max(80),
  chipId: z.enum(['wildcard', 'triple_cap', 'bench_boost', 'emergency_fund']),
}).strict();

const migrationParameterSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const migrationQuerySchema = z.object({
  text: z.string().min(1).max(8_000_000),
  parameters: z.array(migrationParameterSchema).max(100_000).optional().default([]),
}).strict();
const migrationRequestSchema = z.union([
  migrationQuerySchema.extend({ mode: z.literal('query') }),
  migrationQuerySchema.extend({ mode: z.literal('execute') }),
  z.object({
    mode: z.literal('transaction'),
    statements: z.array(migrationQuerySchema).min(1).max(10),
  }).strict(),
]);

interface AuthenticatedRequest extends Request {
  auth?: { userId: string; sessionId: string };
}

interface ApiErrorBody {
  code: string;
  message: string;
  issues?: unknown;
}

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public issues?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface CreateAppOptions {
  db?: SqliteDatabase;
  postgresDb?: PostgresDatabase;
  dbPath?: string;
  secureCookies?: boolean;
  sessionDays?: number;
}

function now(): string {
  return new Date().toISOString();
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeCode(code: string): string {
  return code.replace(/^#/, '').toUpperCase();
}

function jsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return JSON.parse(String(value)) as unknown[];
}

async function issueSession(db: ApplicationDatabase, userId: string, days: number): Promise<{ id: string; token: string; expiresAt: Date }> {
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const createdAt = now();
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  await db.prepare(`INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, userId, tokenHash(token), expiresAt.toISOString(), createdAt, createdAt);
  return { id, token, expiresAt };
}

function setSessionCookie(res: Response, token: string, expiresAt: Date, secure: boolean): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure, sameSite: 'lax', path: '/' });
}

function authMiddleware(db: ApplicationDatabase) {
  return async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    const rawToken = req.cookies?.[SESSION_COOKIE];
    if (typeof rawToken !== 'string' || rawToken.length < 20) return next(new ApiError(401, 'UNAUTHENTICATED', 'Debes iniciar sesión.'));
    const session = await db.prepare(`
      SELECT id, user_id FROM sessions
      WHERE token_hash = ? AND expires_at > ?
    `).get(tokenHash(rawToken), now()) as { id: string; user_id: string } | undefined;
    if (!session) return next(new ApiError(401, 'UNAUTHENTICATED', 'La sesión no existe o expiró.'));
    req.auth = { userId: session.user_id, sessionId: session.id };
    await db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now(), session.id);
    next();
  };
}

function requireUser(req: AuthenticatedRequest): { userId: string; sessionId: string } {
  if (!req.auth) throw new ApiError(401, 'UNAUTHENTICATED', 'Debes iniciar sesión.');
  return req.auth;
}

async function getMe(db: ApplicationDatabase, userId: string): Promise<unknown> {
  const row = await db.prepare(`
    SELECT u.id, u.email, u.username, u.created_at,
      p.manager_name, p.province, p.favorite_club_id, p.avatar_url, p.phone,
      p.notifications_enabled, p.email_alerts_enabled
    FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?
  `).get(userId) as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(404, 'USER_NOT_FOUND', 'La cuenta no existe.');
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    createdAt: row.created_at,
    profile: {
      managerName: row.manager_name,
      phone: row.phone,
      province: row.province,
      favoriteClubId: row.favorite_club_id,
      avatarUrl: row.avatar_url,
      notificationsEnabled: Boolean(row.notifications_enabled),
      emailAlertsEnabled: Boolean(row.email_alerts_enabled),
    },
  };
}

async function getOwnedTeam(db: ApplicationDatabase, userId: string, tournamentId: string) {
  return await db.prepare('SELECT * FROM fantasy_teams WHERE user_id = ? AND tournament_id = ?')
    .get(userId, tournamentId) as Record<string, unknown> | undefined;
}

async function getGameweek(db: ApplicationDatabase, tournamentId: string, requestedId?: string) {
  if (requestedId && requestedId !== 'current') {
    return await db.prepare('SELECT * FROM gameweeks WHERE id = ? AND tournament_id = ?').get(requestedId, tournamentId) as Record<string, unknown> | undefined;
  }
  // "Current" is the earliest gameweek not yet FINISHED — not the earliest with a future
  // deadline. A gameweek's transfer deadline falls before its matches are even played, so once
  // it passes we must keep showing that same gameweek (deadline closed, results pending)
  // instead of jumping ahead to the next one just because its own deadline is still open.
  return await db.prepare(`SELECT * FROM gameweeks WHERE tournament_id = ?
    ORDER BY CASE WHEN status <> 'FINISHED' THEN 0 ELSE 1 END,
      CASE WHEN status <> 'FINISHED' THEN week_number END ASC,
      week_number DESC LIMIT 1`)
    .get(tournamentId) as Record<string, unknown> | undefined;
}

async function requireGameweek(db: ApplicationDatabase, tournamentId: string, requestedId: string): Promise<Record<string, unknown>> {
  const gameweek = await getGameweek(db, tournamentId, requestedId);
  if (!gameweek) throw new ApiError(409, 'GAMEWEEK_NOT_CONFIGURED', 'Todavía no hay una jornada oficial configurada.');
  return gameweek;
}

async function assertGameweekOpen(db: ApplicationDatabase, tournamentId: string, requestedId: string): Promise<Record<string, unknown>> {
  const gameweek = await requireGameweek(db, tournamentId, requestedId);
  if (gameweek.status !== 'OPEN' || Date.parse(String(gameweek.deadline_at)) <= Date.now()) {
    throw new ApiError(409, 'DEADLINE_PASSED', 'La jornada ya cerró; no se permiten cambios de plantilla o alineación.');
  }
  return gameweek;
}

function serializeGameweek(row: Record<string, unknown> | undefined): unknown {
  if (!row) return null;
  return {
    id: row.id, tournamentId: row.tournament_id, weekNumber: row.week_number, name: row.name,
    startsAt: row.starts_at, deadlineAt: row.deadline_at, endsAt: row.ends_at, status: row.status,
  };
}

async function serializeTeam(db: ApplicationDatabase, team: Record<string, unknown>, gameweekId?: string): Promise<unknown> {
  const squad = await db.prepare(`
    SELECT p.id, p.name, p.club_id AS clubId, p.position,
      sp.purchase_price_cents AS purchasePriceCents,
      sp.purchase_gameweek_id AS purchaseGameweekId,
      tp.price_cents AS currentPriceCents,
      COALESCE(tp.last_change_cents, 0) AS priceChangeCents
    FROM squad_players sp
    JOIN players p ON p.id = sp.player_id
    JOIN tournament_players tp ON tp.player_id = p.id AND tp.tournament_id = ?
    WHERE sp.fantasy_team_id = ? ORDER BY p.position, p.name
  `).all(team.tournament_id, team.id) as Array<Record<string, unknown>>;
  const squadWithEconomy = squad.map(player => ({
    ...player,
    ...ownershipPriceQuote(Number(player.purchasePriceCents), Number(player.currentPriceCents)),
  }));
  const currentMarketValueCents = squadWithEconomy.reduce(
    (sum, player) => sum + player.currentPriceCents, 0,
  );
  const sellingSquadValueCents = squadWithEconomy.reduce(
    (sum, player) => sum + player.sellingPriceCents, 0,
  );

  // A sync can move the current gameweek backwards (for example, from the next OPEN
  // round to a LIVE round) after the manager has already saved a valid lineup. Keep
  // the persisted team usable in that case instead of presenting onboarding again.
  const requestedLineup = gameweekId
    ? await db.prepare('SELECT * FROM lineups WHERE fantasy_team_id = ? AND gameweek_id = ?').get(team.id, gameweekId)
    : undefined;
  const lineup = requestedLineup
    ?? await db.prepare('SELECT * FROM lineups WHERE fantasy_team_id = ? ORDER BY submitted_at DESC LIMIT 1').get(team.id);
  let selected: unknown[] = [];
  if (lineup) {
    const value = lineup as Record<string, unknown>;
    selected = await db.prepare(`SELECT player_id AS playerId, role, slot FROM lineup_players
      WHERE fantasy_team_id = ? AND gameweek_id = ? ORDER BY role DESC, slot`)
      .all(team.id, value.gameweek_id);
  }
  const transferHistory = await db.prepare(`SELECT t.id || ':' || ti.player_out_id AS id,
      t.gameweek_id AS gameweek, t.created_at AS createdAt, t.points_cost AS pointsCost,
      po.name AS playerOutName, po.position AS playerOutPosition, co.name AS playerOutClub,
      pi.name AS playerInName, pi.position AS playerInPosition, ci.name AS playerInClub,
      ti.sell_price_cents AS sellPriceCents, ti.buy_price_cents AS buyPriceCents,
      ti.purchase_price_cents AS purchasePriceCents,
      ti.profit_loss_cents AS profitLossCents,
      ti.purchase_gameweek_id AS purchaseGameweekId
    FROM transfers t JOIN transfer_items ti ON ti.transfer_id = t.id
    JOIN players po ON po.id = ti.player_out_id LEFT JOIN clubs co ON co.id = po.club_id
    JOIN players pi ON pi.id = ti.player_in_id LEFT JOIN clubs ci ON ci.id = pi.club_id
    WHERE t.fantasy_team_id = ? ORDER BY t.created_at DESC`).all(team.id) as Array<Record<string, unknown>>;
  return {
    id: team.id,
    tournamentId: team.tournament_id,
    name: team.name,
    formation: team.formation,
    bankCents: team.bank_cents,
    totalPoints: team.total_points,
    gameweekPoints: team.gameweek_points,
    freeTransfers: team.free_transfers,
    transferPenaltyPoints: team.transfer_penalty_points,
    transferHistory: transferHistory.map(item => ({
      id: item.id, gameweek: item.gameweek,
      dateStr: new Date(String(item.createdAt)).toLocaleString('es-PA'),
      playerOutName: item.playerOutName, playerOutClub: item.playerOutClub ?? '',
      playerOutPos: item.playerOutPosition, playerOutPrice: Number(item.sellPriceCents) / 100_000_000,
      purchasePrice: item.purchasePriceCents == null ? undefined : Number(item.purchasePriceCents) / 100_000_000,
      sellingPrice: Number(item.sellPriceCents) / 100_000_000,
      profitLoss: item.profitLossCents == null ? undefined : Number(item.profitLossCents) / 100_000_000,
      purchaseGameweek: item.purchaseGameweekId ?? undefined,
      saleGameweek: item.gameweek,
      playerInName: item.playerInName, playerInClub: item.playerInClub ?? '',
      playerInPos: item.playerInPosition, playerInPrice: Number(item.buyPriceCents) / 100_000_000,
      balanceDiff: (Number(item.sellPriceCents) - Number(item.buyPriceCents)) / 100_000_000,
      pointsCost: -Number(item.pointsCost), isFreeTransfer: Number(item.pointsCost) === 0,
    })),
    squad: squadWithEconomy,
    economy: {
      currentMarketValueCents,
      sellingSquadValueCents,
      bankCents: Number(team.bank_cents),
      totalAvailableValueCents: Number(team.bank_cents) + sellingSquadValueCents,
    },
    lineup: lineup ? {
      gameweekId: (lineup as Record<string, unknown>).gameweek_id,
      formation: (lineup as Record<string, unknown>).formation,
      captainId: (lineup as Record<string, unknown>).captain_player_id,
      viceCaptainId: (lineup as Record<string, unknown>).vice_captain_player_id,
      players: selected,
    } : null,
  };
}

async function replaceLineup(db: ApplicationDatabase, teamId: string, input: z.infer<typeof lineupSchema>): Promise<void> {
  await db.prepare(`INSERT INTO lineups
    (fantasy_team_id, gameweek_id, formation, captain_player_id, vice_captain_player_id, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(fantasy_team_id, gameweek_id) DO UPDATE SET
      formation = excluded.formation, captain_player_id = excluded.captain_player_id,
      vice_captain_player_id = excluded.vice_captain_player_id, submitted_at = excluded.submitted_at`)
    .run(teamId, input.gameweekId, input.formation, input.captainId, input.viceCaptainId, now());
  await db.prepare('DELETE FROM lineup_players WHERE fantasy_team_id = ? AND gameweek_id = ?').run(teamId, input.gameweekId);
  const insert = db.prepare(`INSERT INTO lineup_players
    (fantasy_team_id, gameweek_id, player_id, role, slot) VALUES (?, ?, ?, ?, ?)`);
  for (const [slot, playerId] of input.starters.entries()) await insert.run(teamId, input.gameweekId, playerId, 'STARTER', slot);
  for (const [slot, playerId] of input.bench.entries()) await insert.run(teamId, input.gameweekId, playerId, 'BENCH', slot);
}

async function uniqueLeagueCode(db: ApplicationDatabase): Promise<string> {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const bytes = randomBytes(6);
    const code = [...bytes].map(value => alphabet[value % alphabet.length]).join('');
    if (!await db.prepare('SELECT 1 FROM leagues WHERE code = ?').get(code)) return code;
  }
  throw new ApiError(503, 'CODE_GENERATION_FAILED', 'No fue posible generar el código de liga.');
}

export function createApp(options: CreateAppOptions = {}) {
  const rawDatabase = options.postgresDb ?? options.db ?? openDatabase({ filename: options.dbPath });
  const db = applicationDatabase(rawDatabase);
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production';
  const sessionDays = options.sessionDays ?? SESSION_DAYS;
  const app = express();
  app.disable('x-powered-by');
  // 8mb accommodates a base64-encoded profile photo upload (client caps raw files at 5MB).
  app.use(express.json({ limit: '8mb' }));
  app.use(cookieParser());
  app.locals.db = rawDatabase;

  const migrationDatabase = options.postgresDb;
  if (migrationDatabase && process.env.ENABLE_MIGRATION_ENDPOINT === 'true') {
    app.post('/api/admin/migrate', async (req, res, next) => {
      try {
        const expected = process.env.MIGRATION_SECRET ?? process.env.CRON_SECRET ?? '';
        const provided = req.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
        const expectedBytes = Buffer.from(expected);
        const providedBytes = Buffer.from(provided);
        const authorized = expectedBytes.length > 0
          && expectedBytes.length === providedBytes.length
          && timingSafeEqual(expectedBytes, providedBytes);
        if (!authorized) throw new ApiError(401, 'UNAUTHORIZED', 'Credencial de migración inválida.');

        const request = migrationRequestSchema.parse(req.body);
        if (request.mode === 'query') {
          const rows = await migrationDatabase.query(request.text, request.parameters);
          return res.json({ rows });
        }
        if (request.mode === 'execute') {
          const count = await migrationDatabase.execute(request.text, request.parameters);
          return res.json({ count });
        }
        const results = await migrationDatabase.transaction(async tx => {
          const counts: number[] = [];
          for (const statement of request.statements) {
            counts.push(await tx.execute(statement.text, statement.parameters));
          }
          return counts;
        });
        return res.json({ counts: results });
      } catch (error) {
        return next(error);
      }
    });
  }
  const authAttempts = new Map<string, { count: number; resetAt: number }>();
  const authRateLimit = (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const currentTime = Date.now();
    const current = authAttempts.get(key);
    const entry = !current || current.resetAt <= currentTime
      ? { count: 1, resetAt: currentTime + 15 * 60 * 1000 }
      : { ...current, count: current.count + 1 };
    authAttempts.set(key, entry);
    if (entry.count > 30) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - currentTime) / 1000));
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Demasiados intentos. Intenta nuevamente en unos minutos.' } });
    }
    return next();
  };

  app.get('/api/health', async (_req, res, next) => {
    try {
      await db.prepare('SELECT 1 AS healthy').get();
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, database: options.postgresDb ? 'postgresql' : 'sqlite' });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/catalog', async (req, res, next) => {
    try {
      const requestedId = req.query.tournamentId
        ? z.string().trim().min(1).max(100).parse(req.query.tournamentId)
        : undefined;
      const tournament = requestedId
        ? await db.prepare('SELECT * FROM tournaments WHERE id = ?').get(requestedId)
        : await db.prepare(`SELECT * FROM tournaments
            ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'UPCOMING' THEN 1 ELSE 2 END, starts_at DESC LIMIT 1`).get();
      if (!tournament) {
        return res.json({
          success: true,
          tournament: null,
          clubs: [],
          players: [],
          currentGameweek: null,
          completeness: { status: 'EMPTY', clubCount: 0, playerCount: 0, message: 'Todavía no hay datos canónicos ingeridos.' },
        });
      }
      const record = tournament as Record<string, unknown>;
      const clubs = await db.prepare(`SELECT DISTINCT c.id, c.name, c.code, c.active
        FROM clubs c JOIN players p ON p.club_id = c.id
        JOIN tournament_players tp ON tp.player_id = p.id
        WHERE tp.tournament_id = ? AND tp.active = TRUE AND p.active = TRUE ORDER BY c.name`).all(record.id);
      const players = await db.prepare(`SELECT p.id, p.name, p.display_name AS displayName,
          p.club_id AS clubId, p.position, p.shirt_number AS shirtNumber, p.image_url AS imageUrl,
          tp.price_cents AS priceCents, tp.previous_price_cents AS previousPriceCents,
          tp.last_change_cents AS priceChangeCents, tp.price_updated_at AS priceUpdatedAt,
          tp.pricing_version AS pricingVersion, p.status, tp.active,
          COALESCE(stat.goals, 0) AS goals,
          COALESCE(stat.assists, 0) AS assists,
          COALESCE(stat.yellowCards, 0) AS yellowCards,
          COALESCE(stat.redCards, 0) AS redCards,
          COALESCE(stat.ownGoals, 0) AS ownGoals,
          COALESCE(stat.matchesPlayed, 0) AS matchesPlayed,
          COALESCE(points.totalPoints, 0) AS totalPoints,
          ROUND(COALESCE(latestPrice.recent_form, points.recentForm, 0), 2) AS recentForm,
          COALESCE(points.cleanSheets, 0) AS cleanSheets,
          COALESCE(lastWeek.lastGwPoints, 0) AS lastGwPoints
        FROM tournament_players tp JOIN players p ON p.id = tp.player_id
        LEFT JOIN (
          SELECT player_id, SUM(goals) AS goals,
            SUM(CASE WHEN assist_status IN ('CONFIRMED', 'CORRECTED') THEN assists ELSE 0 END) AS assists,
            SUM(yellow_cards) AS yellowCards, SUM(red_cards) AS redCards,
            SUM(own_goals) AS ownGoals, COUNT(DISTINCT match_id) AS matchesPlayed
          FROM player_match_stats GROUP BY player_id
        ) stat ON stat.player_id = p.id
        LEFT JOIN (
          SELECT player_id, SUM(total_points) AS totalPoints, AVG(total_points) AS recentForm,
            SUM(CASE WHEN clean_sheet_points > 0 THEN 1 ELSE 0 END) AS cleanSheets
          FROM player_fantasy_points GROUP BY player_id
        ) points ON points.player_id = p.id
        LEFT JOIN player_price_history latestPrice
          ON latestPrice.tournament_id = tp.tournament_id
          AND latestPrice.player_id = tp.player_id
          AND latestPrice.gameweek_id = tp.last_calculated_gameweek_id
          AND latestPrice.formula_version = tp.pricing_version
        LEFT JOIN (
          SELECT player_id, SUM(total_points) AS lastGwPoints FROM player_fantasy_points
          WHERE gameweek_id = (
            SELECT id FROM gameweeks WHERE tournament_id = ? AND status = 'FINISHED'
            ORDER BY week_number DESC LIMIT 1
          ) GROUP BY player_id
        ) lastWeek ON lastWeek.player_id = p.id
        WHERE tp.tournament_id = ? AND tp.active = TRUE AND p.active = TRUE ORDER BY p.name`).all(record.id, record.id);
      const historyRows = await db.prepare(`SELECT pph.player_id AS playerId,
          pph.gameweek_id AS gameweekId, gw.name AS gameweekName,
          pph.current_price_cents AS priceCents, pph.change_cents AS changeCents,
          pph.effective_at AS effectiveAt
        FROM player_price_history pph
        LEFT JOIN gameweeks gw ON gw.id = pph.gameweek_id
        WHERE pph.tournament_id = ?
        ORDER BY pph.effective_at, pph.pricing_run_id`).all(record.id) as Array<Record<string, unknown>>;
      const historyByPlayer = new Map<string, Array<Record<string, unknown>>>();
      for (const history of historyRows) {
        const playerId = String(history.playerId);
        const existing = historyByPlayer.get(playerId) ?? [];
        existing.push({
          gameweekId: history.gameweekId, gameweekName: history.gameweekName,
          priceCents: history.priceCents, changeCents: history.changeCents,
          effectiveAt: history.effectiveAt,
        });
        historyByPlayer.set(playerId, existing);
      }
      const playersWithHistory = (players as Array<Record<string, unknown>>).map(player => ({
        ...player,
        priceHistory: historyByPlayer.get(String(player.id)) ?? [],
      }));
      const clubCount = clubs.length;
      const playerCount = players.length;
      const complete = clubCount >= 12 && playerCount >= 180;
      const sourcesStatus: Record<string, string> = {
        LPF: 'NOT_VERIFIED', TRANSFERMARKT: 'NOT_VERIFIED', SOCCERWAY: 'NOT_VERIFIED',
        '365SCORES': 'NOT_VERIFIED', FOTMOB: 'NOT_VERIFIED',
      };
      const sourceRuns = await db.prepare(`SELECT sr.source, sr.status, sr.finished_at AS finishedAt
        FROM sync_runs sr JOIN (
          SELECT source, MAX(finished_at) AS finished_at FROM sync_runs WHERE source <> 'ALL' GROUP BY source
        ) latest ON latest.source = sr.source AND latest.finished_at = sr.finished_at`).all() as
        Array<{ source: string; status: string; finishedAt: string }>;
      sourceRuns.forEach(run => { sourcesStatus[run.source] = run.status; });
      const lastSyncTimestamp = sourceRuns.map(run => run.finishedAt).sort().at(-1) ?? '';
      const currentGameweek = await getGameweek(db, String(record.id));
      res.json({
        success: true,
        tournament: {
          id: record.id,
          name: record.name,
          status: record.status,
          budgetCents: record.budget_cents,
          startsAt: record.starts_at,
          endsAt: record.ends_at,
        },
        clubs,
        players: playersWithHistory,
        currentGameweek: serializeGameweek(currentGameweek),
        completeness: {
          status: complete ? 'CATALOG_COMPLETE' : 'CATALOG_INCOMPLETE',
          clubCount,
          playerCount,
          message: complete
            ? 'El mercado activo contiene 12 clubes y al menos 180 jugadores; revisa por separado el estado de cada fuente.'
            : 'El catálogo aún no alcanza 12 clubes y 180 jugadores; no se declara cobertura total.',
          sourcesStatus,
          lastSyncTimestamp,
        },
      });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/register', authRateLimit, async (req, res, next) => {
    try {
      const input = registerSchema.parse(req.body);
      const passwordHash = bcrypt.hashSync(input.password, 12);
      const userId = randomUUID();
      const timestamp = now();
      const session = await db.transaction(async () => {
        await db.prepare(`INSERT INTO users (id, email, username, password_hash, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .run(userId, input.email.toLowerCase(), input.username, passwordHash, timestamp, timestamp);
        await db.prepare(`INSERT INTO profiles (user_id, manager_name, updated_at) VALUES (?, ?, ?)`)
          .run(userId, input.managerName, timestamp);
        return issueSession(db, userId, sessionDays);
      })();
      setSessionCookie(res, session.token, session.expiresAt, secureCookies);
      res.status(201).json({ success: true, user: await getMe(db, userId) });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/login', authRateLimit, async (req, res, next) => {
    try {
      const input = loginSchema.parse(req.body);
      const identifier = input.email.replace(/^@/, '');
      const user = await db.prepare(`SELECT id, password_hash FROM users
        WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE`)
        .get(identifier, identifier) as { id: string; password_hash: string } | undefined;
      if (!user || !bcrypt.compareSync(input.password, user.password_hash)) {
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Correo, usuario o contraseña incorrectos.');
      }
      const session = await issueSession(db, user.id, sessionDays);
      setSessionCookie(res, session.token, session.expiresAt, secureCookies);
      res.json({ success: true, user: await getMe(db, user.id) });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/logout', async (req, res, next) => {
    try {
      const rawToken = req.cookies?.[SESSION_COOKIE];
      if (typeof rawToken === 'string') await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(rawToken));
      clearSessionCookie(res, secureCookies);
      res.status(204).send();
    } catch (error) { next(error); }
  });

  const authenticated = authMiddleware(db);

  app.get('/api/me', authenticated, async (req: AuthenticatedRequest, res, next) => {
    try { res.json({ success: true, user: await getMe(db, requireUser(req).userId) }); } catch (error) { next(error); }
  });

  app.post('/api/auth/change-password', authenticated, async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = changePasswordSchema.parse(req.body);
      const { userId } = requireUser(req);
      const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string } | undefined;
      if (!row || !bcrypt.compareSync(input.currentPassword, row.password_hash)) {
        throw new ApiError(401, 'INVALID_CURRENT_PASSWORD', 'La contraseña actual no es correcta.');
      }
      const passwordHash = bcrypt.hashSync(input.newPassword, 12);
      await db.transaction(async () => {
        await db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now(), userId);
        await db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, requireUser(req).sessionId);
      })();
      res.json({ success: true });
    } catch (error) { next(error); }
  });

  app.get('/api/auth/session', authenticated, async (req: AuthenticatedRequest, res, next) => {
    try { res.json({ success: true, user: await getMe(db, requireUser(req).userId) }); } catch (error) { next(error); }
  });

  app.get('/api/onboarding/draft', authenticated, async (req: AuthenticatedRequest, res, next) => {
    try {
      const tournamentId = z.string().trim().min(1).max(100).parse(req.query.tournamentId);
      const row = await db.prepare('SELECT * FROM onboarding_drafts WHERE user_id = ? AND tournament_id = ?')
        .get(requireUser(req).userId, tournamentId) as Record<string, unknown> | undefined;
      res.json({ success: true, draft: row ? {
        tournamentId, step: row.step, teamName: row.team_name ?? '', province: row.province ?? '',
        favoriteClubId: row.favorite_club_id ?? '', formation: row.formation ?? '4-3-3',
        selectedPlayerIds: jsonArray(row.selected_player_ids_json),
        starters: jsonArray(row.starters_json), bench: jsonArray(row.bench_json),
        captainId: row.captain_player_id ?? '', viceCaptainId: row.vice_captain_player_id ?? '',
        updatedAt: row.updated_at,
      } : null });
    } catch (error) { next(error); }
  });

  app.put('/api/onboarding/draft', authenticated, async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = onboardingDraftSchema.parse(req.body);
      const userId = requireUser(req).userId;
      await db.prepare(`INSERT INTO onboarding_drafts
        (user_id, tournament_id, step, team_name, province, favorite_club_id, formation,
          selected_player_ids_json, starters_json, bench_json, captain_player_id, vice_captain_player_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, tournament_id) DO UPDATE SET step = excluded.step, team_name = excluded.team_name,
          province = excluded.province, favorite_club_id = excluded.favorite_club_id, formation = excluded.formation,
          selected_player_ids_json = excluded.selected_player_ids_json, starters_json = excluded.starters_json,
          bench_json = excluded.bench_json, captain_player_id = excluded.captain_player_id,
          vice_captain_player_id = excluded.vice_captain_player_id, updated_at = excluded.updated_at`)
        .run(userId, input.tournamentId, input.step, input.teamName, input.province,
          input.favoriteClubId || null, input.formation, JSON.stringify(input.selectedPlayerIds),
          JSON.stringify(input.starters), JSON.stringify(input.bench), input.captainId || null,
          input.viceCaptainId || null, now());
      res.json({ success: true });
    } catch (error) { next(error); }
  });

  app.get('/api/game-state', authenticated, async (req: AuthenticatedRequest, res, next) => {
    try {
      const tournamentId = z.string().trim().min(1).max(100).parse(req.query.tournamentId);
      const userId = requireUser(req).userId;
      const gameweek = await getGameweek(db, tournamentId, req.query.gameweekId ? String(req.query.gameweekId) : undefined);
      const team = await getOwnedTeam(db, userId, tournamentId);
      const chips = team ? await db.prepare(`SELECT chip_id AS chipId, unlocked_at AS unlockedAt,
        active_gameweek_id AS activeGameweekId, used_gameweek_id AS usedGameweekId
        FROM team_chips WHERE fantasy_team_id = ? ORDER BY chip_id`).all(team.id) : [];
      const rewards = team ? await db.prepare(`SELECT mastery_xp AS masteryXp, tactical_coins AS tacticalCoins
        FROM team_reward_state WHERE fantasy_team_id = ?`).get(team.id) : null;
      res.json({ success: true, gameweek: serializeGameweek(gameweek), chips, rewards: rewards ?? { masteryXp: 0, tacticalCoins: 0 } });
    } catch (error) { next(error); }
  });

  app.post('/api/chips/activate', authenticated, async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = chipSchema.parse(req.body);
      const team = await getOwnedTeam(db, requireUser(req).userId, input.tournamentId);
      if (!team) throw new ApiError(404, 'TEAM_NOT_FOUND', 'No tienes equipo en este torneo.');
      const gameweek = await assertGameweekOpen(db, input.tournamentId, input.gameweekId);
      const existing = await db.prepare('SELECT * FROM team_chips WHERE fantasy_team_id = ? AND chip_id = ?')
        .get(team.id, input.chipId) as Record<string, unknown> | undefined;
      if (!existing?.unlocked_at) throw new ApiError(409, 'CHIP_LOCKED', 'Este comodín todavía no está desbloqueado.');
      if (existing?.used_gameweek_id) throw new ApiError(409, 'CHIP_ALREADY_USED', 'Este comodín ya fue utilizado en el torneo.');
      await db.transaction(async () => {
        await db.prepare('UPDATE team_chips SET active_gameweek_id = NULL, activated_at = NULL WHERE fantasy_team_id = ?').run(team.id);
        await db.prepare(`UPDATE team_chips SET active_gameweek_id = ?, activated_at = ?
          WHERE fantasy_team_id = ? AND chip_id = ?`).run(gameweek.id, now(), team.id, input.chipId);
      })();
      res.json({ success: true, activeChip: input.chipId, gameweekId: gameweek.id });
    } catch (error) { next(error); }
  });

  app.post('/api/chips/deactivate', authenticated, async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = chipSchema.parse(req.body);
      const team = await getOwnedTeam(db, requireUser(req).userId, input.tournamentId);
      if (!team) throw new ApiError(404, 'TEAM_NOT_FOUND', 'No tienes equipo en este torneo.');
      await assertGameweekOpen(db, input.tournamentId, input.gameweekId);
      await db.prepare(`UPDATE team_chips SET active_gameweek_id = NULL, activated_at = NULL
        WHERE fantasy_team_id = ? AND chip_id = ? AND used_gameweek_id IS NULL`).run(team.id, input.chipId);
      res.json({ success: true });
    } catch (error) { next(error); }
  });

  app.patch('/api/profile', authenticated, async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = profileSchema.parse(req.body);
      const userId = requireUser(req).userId;
      const current = await db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId) as Record<string, unknown>;
      await db.transaction(async () => {
        if (input.email || input.username) await db.prepare(`UPDATE users SET email = COALESCE(?, email),
          username = COALESCE(?, username), updated_at = ? WHERE id = ?`).run(input.email?.toLowerCase() ?? null, input.username ?? null, now(), userId);
        await db.prepare(`UPDATE profiles SET manager_name = ?, phone = ?, province = ?, favorite_club_id = ?, avatar_url = ?,
          notifications_enabled = ?, email_alerts_enabled = ?, updated_at = ? WHERE user_id = ?`)
          .run(input.managerName ?? current.manager_name, input.phone ?? current.phone,
            input.province ?? current.province, input.favoriteClubId === undefined ? current.favorite_club_id : input.favoriteClubId,
            input.avatarUrl ?? current.avatar_url,
            input.notificationsEnabled === undefined ? current.notifications_enabled : input.notificationsEnabled,
            input.emailAlertsEnabled === undefined ? current.email_alerts_enabled : input.emailAlertsEnabled, now(), userId);
        if (input.teamName && input.tournamentId) await db.prepare(`UPDATE fantasy_teams SET name = ?, updated_at = ?
          WHERE user_id = ? AND tournament_id = ?`).run(input.teamName, now(), userId, input.tournamentId);
      })();
      res.json({ success: true, user: await getMe(db, userId) });
    } catch (error) { next(error); }
  });

  app.get('/api/team', authenticated, async (req: AuthenticatedRequest, res, next) => {
    try {
      const tournamentId = z.string().min(1).max(100).parse(req.query.tournamentId);
      const gameweekId = req.query.gameweekId ? z.string().min(1).max(80).parse(req.query.gameweekId) : undefined;
      const team = await getOwnedTeam(db, requireUser(req).userId, tournamentId);
      const currentGameweek = gameweekId === 'current' ? await getGameweek(db, tournamentId, gameweekId) : undefined;
      const resolvedId = gameweekId === 'current' ? String(currentGameweek?.id ?? gameweekId) : gameweekId;
      res.json({ success: true, team: team ? await serializeTeam(db, team, resolvedId) : null });
    } catch (error) { next(error); }
  });

  app.post('/api/onboarding', authenticated, async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = onboardingSchema.parse(req.body);
      const userId = requireUser(req).userId;
      // A first-time squad is allowed to be created/confirmed even after the current
      // gameweek's deadline has passed — the deadline only gates edits to an existing team.
      const gameweek = await requireGameweek(db, input.tournamentId, input.gameweekId);
      const effectiveInput = { ...input, gameweekId: String(gameweek.id) };
      const allIds = [...input.starters, ...input.bench];
      const players = await loadTournamentPlayers(db, input.tournamentId, allIds);
      const squadCost = validateSquad(players);
      validateLineup(players, input.formation, input.starters, input.bench, input.captainId, input.viceCaptainId);
      const tournament = await db.prepare('SELECT budget_cents, status FROM tournaments WHERE id = ?').get(input.tournamentId) as
        { budget_cents: number; status: string } | undefined;
      if (!tournament) throw new ApiError(404, 'TOURNAMENT_NOT_FOUND', 'El torneo no existe.');
      if (tournament.status === 'FINISHED') throw new ApiError(409, 'TOURNAMENT_FINISHED', 'El torneo ya terminó.');
      if (squadCost > tournament.budget_cents) throw new TeamRuleError('La plantilla supera el presupuesto del torneo.');
      const teamId = randomUUID();
      const timestamp = now();
      await db.transaction(async () => {
        await db.prepare(`INSERT INTO fantasy_teams
          (id, user_id, tournament_id, name, formation, bank_cents, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(teamId, userId, input.tournamentId, input.teamName, input.formation,
            tournament.budget_cents - squadCost, timestamp, timestamp);
        const insertPlayer = db.prepare(`INSERT INTO squad_players
          (fantasy_team_id, player_id, purchase_price_cents, acquired_at, purchase_gameweek_id)
          VALUES (?, ?, ?, ?, ?)`);
        for (const player of players) await insertPlayer.run(
          teamId, player.id, player.price_cents, timestamp, effectiveInput.gameweekId,
        );
        await replaceLineup(db, teamId, effectiveInput);
        if (input.province !== undefined || input.favoriteClubId !== undefined) {
          await db.prepare(`UPDATE profiles
            SET province = CASE WHEN ? THEN ? ELSE province END,
              favorite_club_id = CASE WHEN ? THEN ? ELSE favorite_club_id END,
              updated_at = ? WHERE user_id = ?`)
            .run(
              input.province !== undefined, input.province ?? null,
              input.favoriteClubId !== undefined, input.favoriteClubId ?? null,
              timestamp, userId,
            );
        }
        await db.prepare(`INSERT INTO team_reward_state (fantasy_team_id, mastery_xp, tactical_coins, updated_at)
          VALUES (?, 0, 0, ?)` ).run(teamId, timestamp);
        await db.prepare(`INSERT INTO team_chips (fantasy_team_id, chip_id, unlocked_at)
          VALUES (?, 'wildcard', ?)` ).run(teamId, timestamp);
        await db.prepare('DELETE FROM onboarding_drafts WHERE user_id = ? AND tournament_id = ?').run(userId, input.tournamentId);
      })();
      const team = (await getOwnedTeam(db, userId, input.tournamentId))!;
      res.status(201).json({ success: true, team: await serializeTeam(db, team, effectiveInput.gameweekId) });
    } catch (error) { next(error); }
  });

  app.put('/api/team/lineup', authenticated, async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = lineupSchema.parse(req.body);
      const userId = requireUser(req).userId;
      const gameweek = await assertGameweekOpen(db, input.tournamentId, input.gameweekId);
      const effectiveInput = { ...input, gameweekId: String(gameweek.id) };
      const team = await getOwnedTeam(db, userId, input.tournamentId);
      if (!team) throw new ApiError(404, 'TEAM_NOT_FOUND', 'No tienes equipo en este torneo.');
      const squadRows = await db.prepare('SELECT player_id FROM squad_players WHERE fantasy_team_id = ?').all(team.id) as unknown as { player_id: string }[];
      const squadIds = squadRows.map(row => row.player_id);
      const players = await loadTournamentPlayers(db, input.tournamentId, squadIds);
      validateLineup(players, input.formation, input.starters, input.bench, input.captainId, input.viceCaptainId);
      await db.transaction(async () => {
        await replaceLineup(db, String(team.id), effectiveInput);
        await db.prepare('UPDATE fantasy_teams SET formation = ?, updated_at = ? WHERE id = ?')
          .run(input.formation, now(), team.id);
      })();
      const updatedTeam = (await getOwnedTeam(db, userId, input.tournamentId))!;
      res.json({ success: true, team: await serializeTeam(db, updatedTeam, effectiveInput.gameweekId) });
    } catch (error) { next(error); }
  });

  app.get('/api/leagues', authenticated, async (req: AuthenticatedRequest, res, next) => {
    try {
      const tournamentId = z.string().min(1).max(100).parse(req.query.tournamentId);
      const leagues = await db.prepare(`
        SELECT l.id, l.name, l.code, l.tournament_id AS tournamentId, l.owner_user_id AS ownerUserId,
          owner_profile.manager_name AS ownerManagerName, l.created_at AS createdAt, COUNT(*) AS memberCount
        FROM leagues l JOIN league_memberships lm ON lm.league_id = l.id
        JOIN fantasy_teams ft ON ft.id = lm.fantasy_team_id
        JOIN profiles owner_profile ON owner_profile.user_id = l.owner_user_id
        WHERE ft.user_id = ? AND l.tournament_id = ?
        GROUP BY l.id, owner_profile.manager_name ORDER BY l.created_at DESC
      `).all(requireUser(req).userId, tournamentId);
      res.json({ success: true, leagues });
    } catch (error) { next(error); }
  });

  app.post('/api/leagues', authenticated, async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = createLeagueSchema.parse(req.body);
      const userId = requireUser(req).userId;
      const team = await getOwnedTeam(db, userId, input.tournamentId);
      if (!team) throw new ApiError(409, 'TEAM_REQUIRED', 'Debes crear tu equipo antes de crear una liga.');
      const league = { id: randomUUID(), code: await uniqueLeagueCode(db), createdAt: now() };
      await db.transaction(async () => {
        await db.prepare(`INSERT INTO leagues (id, tournament_id, owner_user_id, name, code, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .run(league.id, input.tournamentId, userId, input.name, league.code, league.createdAt);
        await db.prepare(`INSERT INTO league_memberships (league_id, fantasy_team_id, joined_at) VALUES (?, ?, ?)`)
          .run(league.id, team.id, league.createdAt);
      })();
      res.status(201).json({ success: true, league: { ...league, name: input.name, tournamentId: input.tournamentId } });
    } catch (error) { next(error); }
  });

  app.post('/api/leagues/join', authenticated, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { code } = joinLeagueSchema.parse(req.body);
      const userId = requireUser(req).userId;
      const league = await db.prepare('SELECT * FROM leagues WHERE code = ? COLLATE NOCASE').get(normalizeCode(code)) as
        Record<string, unknown> | undefined;
      if (!league) throw new ApiError(404, 'LEAGUE_NOT_FOUND', 'No existe una liga con ese código.');
      const team = await getOwnedTeam(db, userId, String(league.tournament_id));
      if (!team) throw new ApiError(409, 'TEAM_REQUIRED', 'Debes crear tu equipo de este torneo antes de unirte.');
      await db.prepare('INSERT INTO league_memberships (league_id, fantasy_team_id, joined_at) VALUES (?, ?, ?)')
        .run(league.id, team.id, now());
      res.status(201).json({ success: true, league: { id: league.id, name: league.name, code: league.code, tournamentId: league.tournament_id } });
    } catch (error) { next(error); }
  });

  app.delete('/api/leagues/:leagueId/membership', authenticated, async (req: AuthenticatedRequest, res, next) => {
    try {
      const leagueId = z.string().uuid().parse(req.params.leagueId);
      const userId = requireUser(req).userId;
      const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId) as Record<string, unknown> | undefined;
      if (!league) throw new ApiError(404, 'LEAGUE_NOT_FOUND', 'La liga no existe.');
      const team = await getOwnedTeam(db, userId, String(league.tournament_id));
      const member = team && await db.prepare('SELECT 1 FROM league_memberships WHERE league_id = ? AND fantasy_team_id = ?').get(leagueId, team.id);
      if (!member) throw new ApiError(404, 'MEMBERSHIP_NOT_FOUND', 'No perteneces a esta liga.');
      await db.transaction(async () => {
        await db.prepare('DELETE FROM league_memberships WHERE league_id = ? AND fantasy_team_id = ?').run(leagueId, team!.id);
        const successor = await db.prepare(`SELECT ft.user_id FROM league_memberships lm
          JOIN fantasy_teams ft ON ft.id = lm.fantasy_team_id WHERE lm.league_id = ? ORDER BY lm.joined_at LIMIT 1`)
          .get(leagueId) as { user_id: string } | undefined;
        if (!successor) await db.prepare('DELETE FROM leagues WHERE id = ?').run(leagueId);
        else if (league.owner_user_id === userId) await db.prepare('UPDATE leagues SET owner_user_id = ? WHERE id = ?').run(successor.user_id, leagueId);
      })();
      res.status(204).send();
    } catch (error) { next(error); }
  });

  app.get('/api/leagues/:leagueId/leaderboard', authenticated, async (req: AuthenticatedRequest, res, next) => {
    try {
      const leagueId = z.string().uuid().parse(req.params.leagueId);
      const userId = requireUser(req).userId;
      const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId) as Record<string, unknown> | undefined;
      if (!league) throw new ApiError(404, 'LEAGUE_NOT_FOUND', 'La liga no existe.');
      const allowed = await db.prepare(`SELECT 1 FROM league_memberships lm JOIN fantasy_teams ft ON ft.id = lm.fantasy_team_id
        WHERE lm.league_id = ? AND ft.user_id = ?`).get(leagueId, userId);
      if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'No perteneces a esta liga.');
      const currentGameweek = await getGameweek(db, String(league.tournament_id));
      const leaderboardRows = await db.prepare(`
        SELECT ft.id AS fantasyTeamId, ft.name AS teamName, p.manager_name AS managerName,
          ft.total_points AS totalPoints, ft.gameweek_points AS gameweekPoints,
          ft.bank_cents AS bankCents, lm.joined_at AS joinedAt,
          CASE WHEN ft.user_id = ? THEN TRUE ELSE FALSE END AS isCurrentUser
        FROM league_memberships lm JOIN fantasy_teams ft ON ft.id = lm.fantasy_team_id
        JOIN profiles p ON p.user_id = ft.user_id WHERE lm.league_id = ?
        ORDER BY ft.total_points DESC, ft.gameweek_points DESC, lm.joined_at ASC
      `).all(userId, leagueId) as Array<Record<string, unknown>>;
      const leaderboard = await Promise.all(leaderboardRows.map(async (entry, index) => {
        const team = await db.prepare('SELECT * FROM fantasy_teams WHERE id = ?').get(entry.fantasyTeamId) as Record<string, unknown>;
        const snapshot = await serializeTeam(db, team, currentGameweek ? String(currentGameweek.id) : undefined) as {
          formation: string;
          lineup: null | { formation: string; captainId: string; viceCaptainId: string; players: Array<{ playerId: string; role: string }> };
        };
        return {
          rank: index + 1, ...entry,
          formation: snapshot.lineup?.formation ?? snapshot.formation,
          starters: snapshot.lineup?.players.filter(player => player.role === 'STARTER').map(player => player.playerId) ?? [],
          bench: snapshot.lineup?.players.filter(player => player.role === 'BENCH').map(player => player.playerId) ?? [],
          captainId: snapshot.lineup?.captainId ?? '',
          viceCaptainId: snapshot.lineup?.viceCaptainId ?? '',
        };
      }));
      res.json({ success: true, leaderboard });
    } catch (error) { next(error); }
  });

  app.post('/api/transfers', authenticated, async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = transferSchema.parse(req.body);
      const userId = requireUser(req).userId;
      const resolvedGameweek = await assertGameweekOpen(db, input.tournamentId, input.gameweekId);
      const actualGameweekId = String(resolvedGameweek.id);
      const team = await getOwnedTeam(db, userId, input.tournamentId);
      if (!team) throw new ApiError(404, 'TEAM_NOT_FOUND', 'No tienes equipo en este torneo.');
      const outIds = input.items.map(item => item.playerOutId);
      const inIds = input.items.map(item => item.playerInId);
      if (new Set(outIds).size !== outIds.length || new Set(inIds).size !== inIds.length || outIds.some(id => inIds.includes(id))) {
        throw new TeamRuleError('Los cambios no pueden repetir ni cruzar jugadores.');
      }
      const current = await db.prepare(`SELECT sp.player_id, sp.purchase_price_cents, p.position
        FROM squad_players sp JOIN players p ON p.id = sp.player_id WHERE sp.fantasy_team_id = ?`)
        .all(team.id) as { player_id: string; purchase_price_cents: number; position: z.infer<typeof POSITION> }[];
      const currentIds = new Set(current.map(row => row.player_id));
      if (outIds.some(id => !currentIds.has(id)) || inIds.some(id => currentIds.has(id))) {
        throw new TeamRuleError('La transferencia contiene jugadores que no corresponden a tu plantilla.');
      }
      const incoming = await loadTournamentPlayers(db, input.tournamentId, inIds);
      if (incoming.length !== inIds.length) throw new TeamRuleError('Uno o más jugadores entrantes no están activos en el torneo.');
      const incomingById = new Map(incoming.map(player => [player.id, player]));
      const currentById = new Map(current.map(player => [player.player_id, player]));
      input.items.forEach(item => {
        if (currentById.get(item.playerOutId)?.position !== incomingById.get(item.playerInId)?.position) {
          throw new TeamRuleError('Cada transferencia debe conservar la posición del jugador saliente.');
        }
      });
      const freeBefore = Number(team.free_transfers);
      const usedFree = Math.min(freeBefore, input.items.length);
      const wildcard = resolvedGameweek ? await db.prepare(`SELECT 1 FROM team_chips
        WHERE fantasy_team_id = ? AND chip_id = 'wildcard' AND active_gameweek_id = ?`)
        .get(team.id, resolvedGameweek.id) : undefined;
      const pointsCost = wildcard ? 0 : (input.items.length - usedFree) * 4;
      const transferId = randomUUID();
      const timestamp = now();
      const execution = await db.transaction(async () => {
        await db.prepare('SELECT id FROM fantasy_teams WHERE id = ? /* FOR_UPDATE */').get(team.id);
        // Prices and ownership are loaded again under the write transaction. These
        // values, rather than an earlier catalog response, authorize the operation.
        const freshCurrent = await db.prepare(`SELECT sp.player_id, sp.purchase_price_cents,
            sp.purchase_gameweek_id, p.position, tp.price_cents AS current_price_cents
          FROM squad_players sp
          JOIN players p ON p.id = sp.player_id
          JOIN tournament_players tp ON tp.player_id = sp.player_id AND tp.tournament_id = ?
          WHERE sp.fantasy_team_id = ?`)
          .all(input.tournamentId, team.id) as Array<{
            player_id: string; purchase_price_cents: number; purchase_gameweek_id: string | null;
            current_price_cents: number; position: z.infer<typeof POSITION>;
          }>;
        const freshCurrentById = new Map(freshCurrent.map(player => [player.player_id, player]));
        if (outIds.some(id => !freshCurrentById.has(id)) || inIds.some(id => freshCurrentById.has(id))) {
          throw new TeamRuleError('La plantilla cambió antes de confirmar la transferencia.');
        }
        const freshIncoming = await loadTournamentPlayers(db, input.tournamentId, inIds);
        if (freshIncoming.length !== inIds.length) {
          throw new TeamRuleError('Uno o más jugadores entrantes ya no están activos en el torneo.');
        }
        const freshIncomingById = new Map(freshIncoming.map(player => [player.id, player]));
        const quotes = new Map(input.items.map(item => {
          const outgoing = freshCurrentById.get(item.playerOutId)!;
          const incomingPlayer = freshIncomingById.get(item.playerInId)!;
          if (outgoing.position !== incomingPlayer.position) {
            throw new TeamRuleError('Cada transferencia debe conservar la posición del jugador saliente.');
          }
          const quote = ownershipPriceQuote(outgoing.purchase_price_cents, outgoing.current_price_cents);
          if ((item.expectedBuyPriceCents !== undefined && item.expectedBuyPriceCents !== incomingPlayer.price_cents) ||
              (item.expectedSellPriceCents !== undefined && item.expectedSellPriceCents !== quote.sellingPriceCents)) {
            throw new ApiError(409, 'PRICE_CHANGED', 'El precio cambió antes de confirmar. Actualiza el mercado e inténtalo de nuevo.');
          }
          return [item.playerOutId, { outgoing, incomingPlayer, quote }] as const;
        }));
        const finalIds = freshCurrent.map(row => row.player_id).filter(id => !outIds.includes(id)).concat(inIds);
        validateSquad(await loadTournamentPlayers(db, input.tournamentId, finalIds));

        const bankBefore = Number((await db.prepare('SELECT bank_cents FROM fantasy_teams WHERE id = ?')
          .get(team.id) as { bank_cents: number }).bank_cents);
        const sellTotal = [...quotes.values()].reduce((sum, value) => sum + value.quote.sellingPriceCents, 0);
        const buyTotal = [...quotes.values()].reduce((sum, value) => sum + value.incomingPlayer.price_cents, 0);
        const bankAfter = bankBefore + sellTotal - buyTotal;
        if (bankAfter < 0) throw new TeamRuleError('No tienes presupuesto suficiente con los precios actuales.');

        await db.prepare(`INSERT INTO transfers
          (id, fantasy_team_id, gameweek_id, bank_before_cents, bank_after_cents, points_cost, created_at,
           status, operation_origin, confirmed_at, wildcard_used)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', 'USER', ?, ?)`)
          .run(transferId, team.id, actualGameweekId, bankBefore, bankAfter, pointsCost, timestamp,
            timestamp, Boolean(wildcard));
        const deletePlayer = db.prepare('DELETE FROM squad_players WHERE fantasy_team_id = ? AND player_id = ?');
        const insertPlayer = db.prepare(`INSERT INTO squad_players
          (fantasy_team_id, player_id, purchase_price_cents, acquired_at, purchase_gameweek_id)
          VALUES (?, ?, ?, ?, ?)`);
        const insertItem = db.prepare(`INSERT INTO transfer_items
          (transfer_id, player_out_id, player_in_id, sell_price_cents, buy_price_cents,
           purchase_price_cents, profit_loss_cents, purchase_gameweek_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const item of input.items) {
          const { outgoing, incomingPlayer: added, quote } = quotes.get(item.playerOutId)!;
          await deletePlayer.run(team.id, item.playerOutId);
          await insertPlayer.run(team.id, item.playerInId, added.price_cents, timestamp, actualGameweekId);
          await insertItem.run(transferId, item.playerOutId, item.playerInId,
            quote.sellingPriceCents, added.price_cents, outgoing.purchase_price_cents,
            quote.profitLossCents, outgoing.purchase_gameweek_id);
          await db.prepare(`UPDATE lineup_players SET player_id = ?
            WHERE fantasy_team_id = ? AND gameweek_id = ? AND player_id = ?`)
            .run(item.playerInId, team.id, actualGameweekId, item.playerOutId);
          await db.prepare(`UPDATE lineups SET captain_player_id = CASE WHEN captain_player_id = ? THEN ? ELSE captain_player_id END,
            vice_captain_player_id = CASE WHEN vice_captain_player_id = ? THEN ? ELSE vice_captain_player_id END,
            submitted_at = ? WHERE fantasy_team_id = ? AND gameweek_id = ?`)
            .run(item.playerOutId, item.playerInId, item.playerOutId, item.playerInId, timestamp, team.id, actualGameweekId);
        }
        await db.prepare(`UPDATE fantasy_teams SET bank_cents = ?, free_transfers = ?,
          transfer_penalty_points = transfer_penalty_points + ?, updated_at = ? WHERE id = ?`)
          .run(bankAfter, wildcard ? freeBefore : freeBefore - usedFree, pointsCost, timestamp, team.id);
        return { bankBefore, bankAfter };
      })();
      res.status(201).json({
        success: true,
        transfer: { id: transferId, gameweekId: actualGameweekId,
          bankBeforeCents: execution.bankBefore, bankAfterCents: execution.bankAfter, pointsCost },
        team: await serializeTeam(db, (await getOwnedTeam(db, userId, input.tournamentId))!, actualGameweekId),
      });
    } catch (error) { next(error); }
  });

  app.get('/api/matches', authenticated, async (req, res, next) => {
    try {
      const gameweekId = req.query.gameweekId ? z.string().trim().min(1).max(80).parse(req.query.gameweekId) : undefined;
      const tournamentId = req.query.tournamentId ? z.string().trim().min(1).max(100).parse(req.query.tournamentId) : undefined;
      const resolved = tournamentId ? await getGameweek(db, tournamentId, gameweekId) : undefined;
      const rows = resolved ? await db.prepare(`SELECT m.id, m.gameweek_id AS gameweekId,
        m.home_club_id AS homeClubId, m.away_club_id AS awayClubId,
        m.home_club_name AS homeClubName, m.away_club_name AS awayClubName,
        m.starts_at AS startsAt, m.home_score AS homeScore, m.away_score AS awayScore,
        m.round, m.score_status AS scoreStatus
        FROM matches m WHERE m.gameweek_id = ? ORDER BY m.starts_at, m.id`).all(resolved.id) : [];
      res.json({ success: true, gameweek: serializeGameweek(resolved), matches: rows });
    } catch (error) { next(error); }
  });

  app.get('/api/players/:playerId/stats', authenticated, async (req, res, next) => {
    try {
      const playerId = z.string().trim().min(1).max(100).parse(req.params.playerId);
      const exists = await db.prepare('SELECT 1 FROM players WHERE id = ?').get(playerId);
      if (!exists) throw new ApiError(404, 'PLAYER_NOT_FOUND', 'El jugador no existe.');
      const stats = await db.prepare(`SELECT s.match_id AS matchId, m.gameweek_id AS gameweekId,
        m.starts_at AS startsAt, m.home_club_name AS homeClubName, m.away_club_name AS awayClubName,
        s.starter, s.substitute_in AS substituteIn, s.minutes, s.goals, s.assists,
        s.assist_status AS assistStatus, s.yellow_cards AS yellowCards, s.red_cards AS redCards,
        s.own_goals AS ownGoals, s.saves, s.source, s.source_url AS sourceUrl,
        fp.total_points AS fantasyPoints, fp.calculation_version AS calculationVersion
        FROM player_match_stats s JOIN matches m ON m.id = s.match_id
        LEFT JOIN player_fantasy_points fp ON fp.player_id = s.player_id AND fp.match_id = s.match_id
        WHERE s.player_id = ? ORDER BY m.starts_at DESC`).all(playerId);
      res.json({ success: true, playerId, stats });
    } catch (error) { next(error); }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'La ruta solicitada no existe.' } });
  });

  const webRoot = resolve(process.cwd(), 'dist');
  if (!process.env.VERCEL && existsSync(webRoot)) {
    app.use(express.static(webRoot));
    app.use((req, res, next) => {
      if (req.method === 'GET' && req.accepts('html')) return res.sendFile(resolve(webRoot, 'index.html'));
      return next();
    });
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    let status = 500;
    let body: ApiErrorBody = { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado.' };
    if (error instanceof ZodError) {
      status = 400;
      body = { code: 'VALIDATION_ERROR', message: 'Los datos enviados no son válidos.', issues: error.issues };
    } else if (error instanceof TeamRuleError) {
      status = 422;
      body = { code: 'TEAM_RULE_VIOLATION', message: error.message };
    } else if (error instanceof ApiError) {
      status = error.status;
      body = { code: error.code, message: error.message, issues: error.issues };
    } else if (error instanceof Error && (
      /UNIQUE constraint failed/.test(error.message) || (error as Error & { code?: string }).code === '23505'
    )) {
      status = 409;
      body = { code: 'CONFLICT', message: 'Ya existe un registro con esos datos.' };
    } else if (error instanceof Error && (
      /FOREIGN KEY constraint failed/.test(error.message) || (error as Error & { code?: string }).code === '23503'
    )) {
      status = 422;
      body = { code: 'INVALID_REFERENCE', message: 'Uno de los registros relacionados no existe.' };
    } else if (process.env.NODE_ENV !== 'production' && error instanceof Error) {
      body.issues = error.message;
    }
    res.status(status).json({ error: body });
  });

  return app;
}

export { SESSION_COOKIE };

