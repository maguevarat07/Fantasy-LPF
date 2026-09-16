import type { SqliteDatabase } from './db.js';

export type TransferEventOrigin = 'USER' | 'INITIAL_SQUAD' | 'BENCH' | 'SEED' | 'TEST' | 'ADMIN';

export interface MarketMomentumConfig {
  enabled: boolean;
  minimumActiveManagers: number;
  fullStrengthManagers: number;
  minimumWindowTransfers: number;
  windowHours: number;
  wildcardWeight: number;
  netRateForMaximumPressure: number;
  maxPriceImpactCents: number;
  maxTransferItemsPerManager: number;
  minimumManagerAgeHours: number;
}

export const DEFAULT_MARKET_MOMENTUM_CONFIG: Readonly<MarketMomentumConfig> = Object.freeze({
  enabled: false,
  minimumActiveManagers: 500,
  fullStrengthManagers: 1_000,
  minimumWindowTransfers: 100,
  windowHours: 24,
  wildcardWeight: 0.25,
  netRateForMaximumPressure: 0.05,
  maxPriceImpactCents: 10_000_000,
  maxTransferItemsPerManager: 15,
  minimumManagerAgeHours: 24,
});

export interface MarketTransferEvent {
  fantasyTeamId: string;
  playerOutId: string;
  playerInId: string;
  createdAt: string;
  managerCreatedAt: string;
  status: 'CONFIRMED' | 'PENDING' | 'FAILED' | 'REVERTED';
  origin: TransferEventOrigin;
  revertedAt?: string | null;
  wildcardUsed: boolean;
}

export interface MarketMomentumInput {
  playerId: string;
  activeManagers: number;
  transfersIn: number;
  transfersOut: number;
  weightedTransfersIn: number;
  weightedTransfersOut: number;
  qualifyingWindowTransfers: number;
  marketScale: number;
  normalizedNetRate: number;
  momentum: number;
  pricePressureCents: number;
}

export interface MarketMomentumResult {
  enabled: boolean;
  activeManagers: number;
  qualifyingWindowTransfers: number;
  marketScale: number;
  anomalousTeamIds: string[];
  players: Map<string, MarketMomentumInput>;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function finiteInteger(value: string | undefined, fallback: number, minimum: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

function finiteNumber(value: string | undefined, fallback: number, minimum: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

export function marketMomentumConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  base: MarketMomentumConfig = DEFAULT_MARKET_MOMENTUM_CONFIG,
): MarketMomentumConfig {
  return {
    enabled: env.MARKET_MOMENTUM_ENABLED === 'true',
    minimumActiveManagers: finiteInteger(env.MARKET_MOMENTUM_MIN_ACTIVE_MANAGERS, base.minimumActiveManagers, 1),
    fullStrengthManagers: finiteInteger(env.MARKET_MOMENTUM_FULL_STRENGTH_MANAGERS, base.fullStrengthManagers, 1),
    minimumWindowTransfers: finiteInteger(env.MARKET_MOMENTUM_MIN_WINDOW_TRANSFERS, base.minimumWindowTransfers, 1),
    windowHours: finiteNumber(env.MARKET_MOMENTUM_WINDOW_HOURS, base.windowHours, 1),
    wildcardWeight: clamp(finiteNumber(env.MARKET_MOMENTUM_WILDCARD_WEIGHT, base.wildcardWeight, 0), 0, 1),
    netRateForMaximumPressure: finiteNumber(env.MARKET_MOMENTUM_NET_RATE_FOR_MAX, base.netRateForMaximumPressure, 0.000_001),
    maxPriceImpactCents: finiteInteger(env.MARKET_MOMENTUM_MAX_IMPACT_CENTS, base.maxPriceImpactCents, 0),
    maxTransferItemsPerManager: finiteInteger(env.MARKET_MOMENTUM_MAX_ITEMS_PER_MANAGER, base.maxTransferItemsPerManager, 1),
    minimumManagerAgeHours: finiteNumber(env.MARKET_MOMENTUM_MIN_MANAGER_AGE_HOURS, base.minimumManagerAgeHours, 0),
  };
}

export function calculateMarketMomentum(
  activeManagers: number,
  events: readonly MarketTransferEvent[],
  windowEndedAt: string,
  config: MarketMomentumConfig = DEFAULT_MARKET_MOMENTUM_CONFIG,
): MarketMomentumResult {
  const disabled: MarketMomentumResult = {
    enabled: config.enabled,
    activeManagers,
    qualifyingWindowTransfers: 0,
    marketScale: 0,
    anomalousTeamIds: [],
    players: new Map(),
  };
  if (!config.enabled || activeManagers < config.minimumActiveManagers) return disabled;

  const endMs = Date.parse(windowEndedAt);
  if (!Number.isFinite(endMs)) throw new Error('windowEndedAt debe ser una fecha válida.');
  const startMs = endMs - config.windowHours * 60 * 60 * 1000;
  const minimumManagerAgeMs = config.minimumManagerAgeHours * 60 * 60 * 1000;
  const allowed = events.filter(event => {
    const eventMs = Date.parse(event.createdAt);
    const managerMs = Date.parse(event.managerCreatedAt);
    return event.status === 'CONFIRMED'
      && event.origin === 'USER'
      && !event.revertedAt
      && Number.isFinite(eventMs) && eventMs > startMs && eventMs <= endMs
      && Number.isFinite(managerMs) && endMs - managerMs >= minimumManagerAgeMs;
  });

  const itemsByTeam = new Map<string, number>();
  for (const event of allowed) itemsByTeam.set(event.fantasyTeamId, (itemsByTeam.get(event.fantasyTeamId) ?? 0) + 1);
  const anomalousTeamIds = [...itemsByTeam.entries()]
    .filter(([, count]) => count > config.maxTransferItemsPerManager)
    .map(([teamId]) => teamId)
    .sort();
  const anomalous = new Set(anomalousTeamIds);
  const qualifying = allowed.filter(event => !anomalous.has(event.fantasyTeamId));
  const managerScale = activeManagers >= config.fullStrengthManagers
    ? 1
    : clamp((activeManagers - config.minimumActiveManagers)
      / Math.max(1, config.fullStrengthManagers - config.minimumActiveManagers), 0, 1);
  const volumeScale = clamp(qualifying.length / config.minimumWindowTransfers, 0, 1);
  const marketScale = managerScale * volumeScale;

  const counters = new Map<string, { transfersIn: number; transfersOut: number; weightedIn: number; weightedOut: number }>();
  const counter = (playerId: string) => {
    const existing = counters.get(playerId);
    if (existing) return existing;
    const created = { transfersIn: 0, transfersOut: 0, weightedIn: 0, weightedOut: 0 };
    counters.set(playerId, created);
    return created;
  };
  const netByTeamAndPlayer = new Map<string, number>();
  for (const event of qualifying) {
    const weight = event.wildcardUsed ? config.wildcardWeight : 1;
    const incoming = counter(event.playerInId);
    incoming.transfersIn += 1;
    const outgoing = counter(event.playerOutId);
    outgoing.transfersOut += 1;
    const incomingKey = `${event.fantasyTeamId}:${event.playerInId}`;
    const outgoingKey = `${event.fantasyTeamId}:${event.playerOutId}`;
    netByTeamAndPlayer.set(incomingKey, clamp((netByTeamAndPlayer.get(incomingKey) ?? 0) + weight, -1, 1));
    netByTeamAndPlayer.set(outgoingKey, clamp((netByTeamAndPlayer.get(outgoingKey) ?? 0) - weight, -1, 1));
  }
  for (const [key, net] of netByTeamAndPlayer) {
    const playerId = key.slice(key.indexOf(':') + 1);
    const values = counter(playerId);
    if (net > 0) values.weightedIn += net;
    else values.weightedOut += Math.abs(net);
  }

  const players = new Map<string, MarketMomentumInput>();
  for (const [playerId, values] of counters) {
    const normalizedNetRate = (values.weightedIn - values.weightedOut) / activeManagers;
    const momentum = clamp(normalizedNetRate / config.netRateForMaximumPressure, -1, 1) * marketScale;
    const rawPressure = momentum * config.maxPriceImpactCents;
    const pricePressureCents = config.maxPriceImpactCents === 0
      ? 0
      : Math.round(rawPressure / config.maxPriceImpactCents) * config.maxPriceImpactCents;
    players.set(playerId, {
      playerId,
      activeManagers,
      transfersIn: values.transfersIn,
      transfersOut: values.transfersOut,
      weightedTransfersIn: values.weightedIn,
      weightedTransfersOut: values.weightedOut,
      qualifyingWindowTransfers: qualifying.length,
      marketScale,
      normalizedNetRate,
      momentum,
      pricePressureCents: clamp(pricePressureCents, -config.maxPriceImpactCents, config.maxPriceImpactCents),
    });
  }
  return { enabled: true, activeManagers, qualifyingWindowTransfers: qualifying.length, marketScale, anomalousTeamIds, players };
}

export function loadMarketMomentum(
  db: SqliteDatabase,
  tournamentId: string,
  windowEndedAt: string,
  config: MarketMomentumConfig,
): MarketMomentumResult {
  const activeManagers = Number((db.prepare(`SELECT COUNT(*) AS total FROM fantasy_teams ft
    WHERE ft.tournament_id = ? AND ft.created_at <= ?
      AND (SELECT COUNT(*) FROM squad_players sp WHERE sp.fantasy_team_id = ft.id) = 15`)
    .get(tournamentId, windowEndedAt) as { total: number }).total);
  if (!config.enabled || activeManagers < config.minimumActiveManagers) {
    return calculateMarketMomentum(activeManagers, [], windowEndedAt, config);
  }
  const windowStartedAt = new Date(Date.parse(windowEndedAt) - config.windowHours * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`SELECT t.fantasy_team_id AS fantasyTeamId,
      ti.player_out_id AS playerOutId, ti.player_in_id AS playerInId,
      COALESCE(t.confirmed_at, t.created_at) AS createdAt, u.created_at AS managerCreatedAt,
      t.status, t.operation_origin AS origin, t.reverted_at AS revertedAt,
      t.wildcard_used AS wildcardUsed
    FROM transfers t
    JOIN transfer_items ti ON ti.transfer_id = t.id
    JOIN fantasy_teams ft ON ft.id = t.fantasy_team_id
    JOIN users u ON u.id = ft.user_id
    WHERE ft.tournament_id = ?
      AND COALESCE(t.confirmed_at, t.created_at) > ?
      AND COALESCE(t.confirmed_at, t.created_at) <= ?`)
    .all(tournamentId, windowStartedAt, windowEndedAt) as Array<{
      fantasyTeamId: string; playerOutId: string; playerInId: string;
      createdAt: string; managerCreatedAt: string; wildcardUsed: number;
      status: MarketTransferEvent['status']; origin: TransferEventOrigin; revertedAt: string | null;
    }>;
  const events: MarketTransferEvent[] = rows.map(row => ({
    ...row,
    wildcardUsed: row.wildcardUsed === 1,
  }));
  return calculateMarketMomentum(activeManagers, events, windowEndedAt, config);
}
