import type { Express, NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import { z } from 'zod';
import type { ApplicationDatabase } from './applicationDatabase.js';
import { moneyCents } from './money.js';
import { ownershipPriceQuote } from './marketEconomy.js';

type AuthRequest = Request & { auth?: { userId: string; sessionId: string } };
type Handler = (req: AuthRequest, res: Response, next: NextFunction) => void | Promise<void>;
const SESSION_COOKIE = 'fantasy_lpf_session';
const ADMIN_IDLE_MS = 15 * 60_000;
const ADMIN_ABSOLUTE_MS = 8 * 3_600_000;
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
const setupSchema = z.object({ password: z.string().min(1).max(128) }).strict();
const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  search: z.string().trim().max(80).default(''),
  filter: z.enum(['all','active','inactive','onboarding-complete','onboarding-incomplete','has-team','no-team']).default('all'),
  sort: z.enum(['created','name','email']).default('created'),
}).strict();

function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function secretKey(): Buffer {
  const key = Buffer.from(process.env.ADMIN_MFA_ENCRYPTION_KEY ?? '', 'base64');
  if (key.length !== 32) throw new Error('ADMIN_MFA_ENCRYPTION_KEY must be 32 random bytes encoded in base64.');
  return key;
}
function encrypt(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map(part => part.toString('base64url')).join('.');
}
function decrypt(value: string): string {
  const [iv, tag, body] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !body || iv.length !== 12 || tag.length !== 16) throw new Error('Invalid MFA credential.');
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

export async function consumeAdminRateLimit(db: ApplicationDatabase, bucket: string, limit: number, minutes: number): Promise<boolean> {
  const key = hash(bucket);
  const timestamp = new Date().toISOString();
  const reset = new Date(Date.now() + minutes * 60_000).toISOString();
  await db.prepare(`INSERT INTO admin_rate_limits(bucket,attempts,reset_at) VALUES(?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET attempts = CASE WHEN admin_rate_limits.reset_at <= ? THEN 1 ELSE admin_rate_limits.attempts + 1 END,
      reset_at = CASE WHEN admin_rate_limits.reset_at <= ? THEN excluded.reset_at ELSE admin_rate_limits.reset_at END`)
    .run(key, reset, timestamp, timestamp);
  const row = await db.prepare('SELECT attempts FROM admin_rate_limits WHERE bucket=?').get(key);
  return Number(row?.attempts ?? 0) <= limit;
}

export function mountAdminRoutes(app: Express, options: {
  authDb: ApplicationDatabase;
  readDb: ApplicationDatabase;
  authenticated: Handler;
  secureCookies: boolean;
}): void {
  const { authDb, readDb, authenticated, secureCookies } = options;
  const cookieName = secureCookies ? '__Host-fantasy_lpf_admin' : 'fantasy_lpf_admin';
  const wrap = (handler: Handler): Handler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };
  const deny = (res: Response, status: number, code: string) => res.status(status).json({ error: { code, message: 'Acceso administrativo denegado.' } });
  const clearCookie = (res: Response) => res.clearCookie(cookieName, { path: '/', httpOnly: true, secure: secureCookies, sameSite: 'strict' });
  const audit = async (userId: string | null, action: string, result: string, req: Request, targetId?: string) => {
    await authDb.prepare(`INSERT INTO admin_audit_log(id,admin_user_id,action,target_type,target_id,result,request_id,metadata,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(randomUUID(), userId, action, targetId ? 'USER' : null, targetId ?? null,
      result, randomUUID(), '{}', new Date().toISOString());
  };
  const sameOrigin: Handler = (req, res, next) => {
    if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    const host = req.get('host');
    const site = req.get('sec-fetch-site');
    if (!origin || !host || (site && !['same-origin','none'].includes(site))) return void deny(res, 403, 'CSRF_DENIED');
    try {
      const parsed = new URL(origin);
      if (parsed.host !== host || (secureCookies && parsed.protocol !== 'https:')) return void deny(res, 403, 'CSRF_DENIED');
    } catch { return void deny(res, 403, 'CSRF_DENIED'); }
    next();
  };
  const roleGate: Handler = wrap(async (req, res, next) => {
    const userId = req.auth?.userId;
    if (!userId) return void deny(res, 401, 'UNAUTHENTICATED');
    const role = await authDb.prepare('SELECT role FROM admin_user_roles WHERE user_id=?').get(userId);
    if (role?.role !== 'ADMIN' && role?.role !== 'SUPER_ADMIN') {
      await audit(userId, 'ADMIN_ACCESS_DENIED', 'DENIED', req);
      return void deny(res, 403, 'ADMIN_REQUIRED');
    }
    next();
  });
  const adminGate: Handler = wrap(async (req, res, next) => {
    const token = req.cookies?.[cookieName];
    if (typeof token !== 'string' || token.length < 32) return void deny(res, 403, 'MFA_REQUIRED');
    const row = await authDb.prepare(`SELECT s.id,s.last_seen_at,s.expires_at FROM admin_sessions s
      JOIN admin_mfa_credentials m ON m.user_id=s.user_id AND m.confirmed_at IS NOT NULL
      WHERE s.token_hash=? AND s.user_id=? AND s.parent_session_id=?`)
      .get(hash(token), req.auth?.userId, req.auth?.sessionId);
    if (!row || Date.parse(String(row.expires_at)) <= Date.now()
      || Date.parse(String(row.last_seen_at)) + ADMIN_IDLE_MS <= Date.now()) {
      clearCookie(res);
      return void deny(res, 403, 'MFA_REQUIRED');
    }
    await authDb.prepare('UPDATE admin_sessions SET last_seen_at=? WHERE id=?').run(new Date().toISOString(), row.id);
    next();
  });
  const limited: Handler = wrap(async (req, res, next) => {
    const allowed = await consumeAdminRateLimit(authDb, `admin:${req.auth?.userId}:${req.ip}`, 180, 15);
    if (!allowed) return void deny(res, 429, 'RATE_LIMITED');
    next();
  });
  const base: Handler[] = [authenticated, limited, roleGate];
  const protectedRoutes: Handler[] = [...base, adminGate];
  const openSession = async (req: AuthRequest, res: Response) => {
    const userId = req.auth!.userId;
    const parent = req.auth!.sessionId;
    await authDb.prepare('DELETE FROM admin_sessions WHERE parent_session_id=?').run(parent);
    const token = randomBytes(32).toString('base64url');
    const created = new Date();
    const expires = new Date(created.getTime() + ADMIN_ABSOLUTE_MS);
    await authDb.prepare(`INSERT INTO admin_sessions(id,user_id,parent_session_id,token_hash,created_at,last_seen_at,expires_at)
      VALUES(?,?,?,?,?,?,?)`).run(randomUUID(), userId, parent, hash(token), created.toISOString(), created.toISOString(), expires.toISOString());
    res.cookie(cookieName, token, { path: '/', httpOnly: true, secure: secureCookies, sameSite: 'strict', expires });
  };

  app.get('/api/admin/state', ...base, wrap(async (req, res) => {
    const row = await authDb.prepare('SELECT confirmed_at FROM admin_mfa_credentials WHERE user_id=?').get(req.auth!.userId);
    const token = req.cookies?.[cookieName];
    const active = typeof token === 'string' ? await authDb.prepare(`SELECT id FROM admin_sessions
      WHERE token_hash=? AND user_id=? AND parent_session_id=? AND expires_at>? AND last_seen_at>?`)
      .get(hash(token), req.auth!.userId, req.auth!.sessionId, new Date().toISOString(), new Date(Date.now()-ADMIN_IDLE_MS).toISOString()) : null;
    res.setHeader('Cache-Control','no-store');
    res.json({ mfaConfigured: Boolean(row?.confirmed_at), adminSession: Boolean(active && row?.confirmed_at) });
  }));
  app.post('/api/admin/mfa/setup', ...base, sameOrigin, wrap(async (req, res) => {
    const { password } = setupSchema.parse(req.body);
    const userId = req.auth!.userId;
    if (!await consumeAdminRateLimit(authDb, `mfa-setup:${userId}:${req.ip}`, 5, 15)) return void deny(res, 429, 'RATE_LIMITED');
    const row = await authDb.prepare('SELECT password_hash,email FROM users WHERE id=?').get(userId);
    if (!row || !bcrypt.compareSync(password, String(row.password_hash))) return void deny(res, 401, 'INVALID_CREDENTIALS');
    const existing = await authDb.prepare('SELECT confirmed_at FROM admin_mfa_credentials WHERE user_id=?').get(userId);
    if (existing?.confirmed_at) return void deny(res, 409, 'MFA_ALREADY_CONFIGURED');
    const secret = generateSecret();
    await authDb.prepare(`INSERT INTO admin_mfa_credentials(user_id,secret_ciphertext,confirmed_at,last_used_step,created_at)
      VALUES(?,?,NULL,NULL,?) ON CONFLICT(user_id) DO UPDATE SET secret_ciphertext=excluded.secret_ciphertext,
      confirmed_at=NULL,last_used_step=NULL,created_at=excluded.created_at`)
      .run(userId, encrypt(secret), new Date().toISOString());
    await audit(userId, 'MFA_ENROLLMENT_STARTED', 'SUCCESS', req);
    res.setHeader('Cache-Control','no-store');
    res.json({ uri: generateURI({ issuer: 'Fantasy LPF', label: String(row.email), secret }), secret });
  }));
  const verifyCode = async (req: AuthRequest, res: Response, mode: 'confirm' | 'verify') => {
    const { code } = codeSchema.parse(req.body);
    const userId = req.auth!.userId;
    if (!await consumeAdminRateLimit(authDb, `mfa:${userId}:${req.ip}`, 8, 15)) return void deny(res, 429, 'RATE_LIMITED');
    const credential = await authDb.prepare('SELECT secret_ciphertext,confirmed_at,last_used_step FROM admin_mfa_credentials WHERE user_id=?').get(userId);
    if (!credential || Boolean(credential.confirmed_at) !== (mode === 'verify')) return void deny(res, 403, 'MFA_NOT_READY');
    const result = await verify({ secret: decrypt(String(credential.secret_ciphertext)), token: code,
      epochTolerance: 30, afterTimeStep: credential.last_used_step == null ? undefined : Number(credential.last_used_step) });
    if (!result.valid || !('timeStep' in result)) {
      await audit(userId, 'MFA_VERIFICATION', 'DENIED', req);
      return void deny(res, 403, 'INVALID_MFA_CODE');
    }
    const updated = await authDb.prepare(`UPDATE admin_mfa_credentials SET confirmed_at=COALESCE(confirmed_at,?),last_used_step=?
      WHERE user_id=? AND (last_used_step IS NULL OR last_used_step < ?)`)
      .run(new Date().toISOString(), result.timeStep, userId, result.timeStep);
    if (updated.changes !== 1) return void deny(res, 403, 'MFA_REPLAY');
    await openSession(req, res);
    await audit(userId, 'MFA_VERIFICATION', 'SUCCESS', req);
    res.setHeader('Cache-Control','no-store');
    res.json({ success: true });
  };
  app.post('/api/admin/mfa/confirm', ...base, sameOrigin, (req: AuthRequest, res, next) => { void verifyCode(req,res,'confirm').catch(next); });
  app.post('/api/admin/mfa/verify', ...base, sameOrigin, (req: AuthRequest, res, next) => { void verifyCode(req,res,'verify').catch(next); });
  app.post('/api/admin/logout', ...base, sameOrigin, wrap(async (req, res) => {
    await authDb.prepare('DELETE FROM admin_sessions WHERE parent_session_id=?').run(req.auth!.sessionId);
    clearCookie(res);
    await audit(req.auth!.userId, 'ADMIN_LOGOUT', 'SUCCESS', req);
    res.status(204).send();
  }));

  app.get('/api/admin/overview', ...protectedRoutes, wrap(async (_req, res) => {
    const count = async (sql: string) => Number((await readDb.prepare(sql).get())?.total ?? 0);
    const users = await count('SELECT count(*) AS total FROM users');
    const activeUsers = Number((await readDb.prepare('SELECT count(DISTINCT user_id) AS total FROM sessions WHERE last_seen_at >= ?')
      .get(new Date(Date.now() - 7 * 86_400_000).toISOString()))?.total ?? 0);
    const teams = await count('SELECT count(*) AS total FROM fantasy_teams');
    const leagues = await count('SELECT count(*) AS total FROM leagues');
    const transfers = await count('SELECT count(*) AS total FROM transfers');
    const today = new Date(); today.setUTCHours(0,0,0,0);
    const newUsersToday = Number((await readDb.prepare('SELECT count(*) AS total FROM users WHERE created_at >= ?')
      .get(today.toISOString()))?.total ?? 0);
    const newUsersLast7Days = Number((await readDb.prepare('SELECT count(*) AS total FROM users WHERE created_at >= ?')
      .get(new Date(Date.now()-7*86_400_000).toISOString()))?.total ?? 0);
    const onboardingComplete = await count('SELECT count(DISTINCT user_id) AS total FROM fantasy_teams');
    const tournament = await readDb.prepare(`SELECT id,name,status FROM tournaments WHERE status='ACTIVE' LIMIT 1`).get();
    res.setHeader('Cache-Control','no-store');
    res.json({ users, activeUsers, newUsersToday, newUsersLast7Days, onboardingComplete,
      onboardingIncomplete: users-onboardingComplete, teams, leagues, transfers, tournament });
  }));
  app.get('/api/admin/users', ...protectedRoutes, wrap(async (req, res) => {
    const query = listSchema.parse(req.query);
    const order = { created: 'u.created_at DESC', name: 'p.manager_name ASC', email: 'u.email ASC' }[query.sort];
    const pattern = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`;
    const activeSince = new Date(Date.now()-7*86_400_000).toISOString();
    const filterSql = {
      all: '1=1',
      active: '(SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id=u.id) >= ?',
      inactive: 'coalesce((SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id=u.id),\'\') < ?',
      'onboarding-complete': 'EXISTS (SELECT 1 FROM fantasy_teams ft WHERE ft.user_id=u.id)',
      'onboarding-incomplete': 'NOT EXISTS (SELECT 1 FROM fantasy_teams ft WHERE ft.user_id=u.id)',
      'has-team': 'EXISTS (SELECT 1 FROM fantasy_teams ft WHERE ft.user_id=u.id)',
      'no-team': 'NOT EXISTS (SELECT 1 FROM fantasy_teams ft WHERE ft.user_id=u.id)',
    }[query.filter];
    const rows = await readDb.prepare(`SELECT u.id,u.email,u.username,u.created_at AS createdAt,p.manager_name AS name,
      (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id=u.id) AS lastActivity,
      (SELECT count(*) FROM fantasy_teams ft WHERE ft.user_id=u.id) AS teamCount
      FROM users u JOIN profiles p ON p.user_id=u.id
      WHERE (u.email LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\' OR p.manager_name LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM fantasy_teams ft WHERE ft.user_id=u.id AND ft.name LIKE ? ESCAPE '\\'))
        AND ${filterSql}
      ORDER BY ${order} LIMIT ? OFFSET ?`).all(pattern, pattern, pattern, pattern,
        ...(['active','inactive'].includes(query.filter) ? [activeSince] : []), 25, (query.page-1)*25);
    res.setHeader('Cache-Control','no-store');
    res.json({ page: query.page, pageSize: 25, users: rows });
  }));
  app.get('/api/admin/users/:userId', ...protectedRoutes, wrap(async (req, res) => {
    const userId = z.string().uuid().parse(req.params.userId);
    const user = await readDb.prepare(`SELECT u.id,u.email,u.username,u.created_at AS createdAt,
      p.manager_name AS name,p.province FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id=?`).get(userId);
    if (!user) return void res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Usuario no encontrado.' } });
    const teams = await readDb.prepare(`SELECT ft.id,ft.name,ft.tournament_id AS tournamentId,
      ft.total_points AS totalPoints,ft.gameweek_points AS gameweekPoints,ft.bank_cents AS bankCents,
      ft.formation,t.name AS tournamentName FROM fantasy_teams ft JOIN tournaments t ON t.id=ft.tournament_id
      WHERE ft.user_id=? ORDER BY ft.created_at DESC LIMIT 20`).all(userId);
    const rankedTeams = await Promise.all(teams.map(async team => ({ ...team,
      rank: Number((await readDb.prepare(`SELECT count(*) + 1 AS rank FROM fantasy_teams
        WHERE tournament_id=? AND total_points>?`).get(team.tournamentId,team.totalPoints))?.rank ?? 0),
    })));
    const lastActivity = await readDb.prepare('SELECT max(last_seen_at) AS at FROM sessions WHERE user_id=?').get(userId);
    res.setHeader('Cache-Control','no-store');
    res.json({ user: { ...user, lastActivity: lastActivity?.at ?? null }, teams: rankedTeams });
  }));
  app.get('/api/admin/users/:userId/team', ...protectedRoutes, wrap(async (req, res) => {
    const userId = z.string().uuid().parse(req.params.userId);
    const team = await readDb.prepare(`SELECT ft.id,ft.name,ft.tournament_id AS tournamentId,ft.total_points AS totalPoints,
      ft.bank_cents AS bankCents,ft.formation FROM fantasy_teams ft WHERE ft.user_id=? ORDER BY ft.created_at DESC LIMIT 1`).get(userId);
    if (!team) return void res.json({ team: null });
    const squad = await readDb.prepare(`SELECT p.id,p.name,p.position,p.image_url AS imageUrl,c.name AS club,
      sp.purchase_price_cents AS purchasePriceCents,tp.price_cents AS currentPriceCents
      FROM squad_players sp JOIN players p ON p.id=sp.player_id LEFT JOIN clubs c ON c.id=p.club_id
      JOIN tournament_players tp ON tp.player_id=p.id AND tp.tournament_id=?
      WHERE sp.fantasy_team_id=? ORDER BY p.position,p.name LIMIT 15`).all(team.tournamentId, team.id);
    const lineup = await readDb.prepare('SELECT * FROM lineups WHERE fantasy_team_id=? ORDER BY submitted_at DESC LIMIT 1').get(team.id);
    const slots = lineup ? await readDb.prepare(`SELECT player_id AS playerId,role,slot FROM lineup_players
      WHERE fantasy_team_id=? AND gameweek_id=? ORDER BY role DESC,slot`).all(team.id,lineup.gameweek_id) : [];
    const players = squad.map(player => ({ ...player,
      ...ownershipPriceQuote(moneyCents(player.purchasePriceCents,'purchase'),moneyCents(player.currentPriceCents,'current')) }));
    const bank = moneyCents(team.bankCents,'bank');
    res.setHeader('Cache-Control','no-store');
    res.json({ team: { ...team,bankCents:bank }, players, lineup: lineup ? {
      gameweekId: lineup.gameweek_id, formation: lineup.formation, captainId: lineup.captain_player_id,
      viceCaptainId: lineup.vice_captain_player_id, slots } : null,
      economy: { currentSquadValueCents: players.reduce((n,p)=>n+p.currentPriceCents,0),
        sellingSquadValueCents: players.reduce((n,p)=>n+p.sellingPriceCents,0),
        totalAvailableValueCents: bank+players.reduce((n,p)=>n+p.sellingPriceCents,0) } });
  }));
  app.get('/api/admin/users/:userId/transfers', ...protectedRoutes, wrap(async (req, res) => {
    const userId = z.string().uuid().parse(req.params.userId);
    const rows = await readDb.prepare(`SELECT tr.id,tr.gameweek_id AS gameweekId,tr.points_cost AS pointsCost,
      tr.created_at AS createdAt,ti.player_out_id AS playerOutId,ti.player_in_id AS playerInId,
      out_player.name AS playerOutName,in_player.name AS playerInName,
      ti.sell_price_cents AS sellPriceCents,ti.buy_price_cents AS buyPriceCents,
      ti.purchase_price_cents AS purchasePriceCents,ti.profit_loss_cents AS profitLossCents
      FROM transfers tr JOIN fantasy_teams ft ON ft.id=tr.fantasy_team_id
      JOIN transfer_items ti ON ti.transfer_id=tr.id
      JOIN players out_player ON out_player.id=ti.player_out_id
      JOIN players in_player ON in_player.id=ti.player_in_id
      WHERE ft.user_id=? ORDER BY tr.created_at DESC LIMIT 100`).all(userId);
    res.setHeader('Cache-Control','no-store'); res.json({ transfers: rows });
  }));
  app.get('/api/admin/users/:userId/leagues', ...protectedRoutes, wrap(async (req, res) => {
    const userId = z.string().uuid().parse(req.params.userId);
    const rows = await readDb.prepare(`SELECT l.id,l.name,l.tournament_id AS tournamentId,
      ft.id AS teamId,ft.total_points AS points,
      (SELECT count(*) FROM league_memberships members WHERE members.league_id=l.id) AS memberCount,
      (SELECT count(*)+1 FROM league_memberships members JOIN fantasy_teams rivals ON rivals.id=members.fantasy_team_id
        WHERE members.league_id=l.id AND rivals.total_points>ft.total_points) AS position
      FROM league_memberships lm
      JOIN fantasy_teams ft ON ft.id=lm.fantasy_team_id JOIN leagues l ON l.id=lm.league_id
      WHERE ft.user_id=? ORDER BY l.created_at DESC LIMIT 100`).all(userId);
    res.setHeader('Cache-Control','no-store'); res.json({ leagues: rows });
  }));
  app.get('/api/admin/users/:userId/history', ...protectedRoutes, wrap(async (req, res) => {
    const userId = z.string().uuid().parse(req.params.userId);
    const rows = await readDb.prepare(`SELECT gs.gameweek_id AS gameweekId,gs.player_points AS playerPoints,
      gs.captain_bonus AS captainBonus,gs.transfer_penalty AS transferPenalty,gs.total_points AS totalPoints
      FROM team_gameweek_scores gs JOIN fantasy_teams ft ON ft.id=gs.fantasy_team_id
      WHERE ft.user_id=? ORDER BY gs.gameweek_id DESC LIMIT 100`).all(userId);
    res.setHeader('Cache-Control','no-store'); res.json({ gameweeks: rows });
  }));
  app.get('/api/admin/system/status', ...protectedRoutes, wrap(async (_req, res) => {
    const rows = await readDb.prepare(`SELECT id,stage,quality_status AS qualityStatus,started_at AS startedAt,
      finished_at AS finishedAt,scoring_status AS scoringStatus,pricing_status AS pricingStatus
      FROM pipeline_runs ORDER BY started_at DESC LIMIT 1`).all();
    res.setHeader('Cache-Control','no-store'); res.json({ latestRun: rows[0] ?? null });
  }));
}
