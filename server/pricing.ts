import type { SqliteDatabase } from './db.js';
import { calculatePlayerPrices, PRICING_CONFIG, type PricingRunResult } from './pricingEngine.js';
export {
  applyGradualMovement,
  applyMarketPressure,
  calculatePlayerPrices,
  calculatePriceQuotes,
  calculateRecentForm,
  midrankPercentiles,
  PRICING_CONFIG,
  pricingConfigFromEnv,
  roundMoney,
} from './pricingEngine.js';
export type {
  PlayerPriceQuote,
  PlayerPricingInput,
  PricingConfig,
  PricingEngineInput,
  PricingPosition,
  PricingRunResult,
} from './pricingEngine.js';
export {
  calculateMarketMomentum,
  DEFAULT_MARKET_MOMENTUM_CONFIG,
  loadMarketMomentum,
  marketMomentumConfigFromEnv,
} from './marketMomentum.js';
export type {
  MarketMomentumConfig,
  MarketMomentumInput,
  MarketMomentumResult,
  MarketTransferEvent,
  TransferEventOrigin,
} from './marketMomentum.js';

/** Compatibility entry point: prices only the latest closed gameweek and is idempotent. */
export function recalculatePlayerPrices(
  db: SqliteDatabase,
  tournamentId = 'apertura-2026',
): PricingRunResult | { updated: 0; skipped: true; formulaVersion: string } {
  const gameweek = db.prepare(`SELECT id FROM gameweeks WHERE tournament_id = ? AND status = 'FINISHED'
    ORDER BY week_number DESC LIMIT 1`).get(tournamentId) as { id: string } | undefined;
  if (!gameweek) return { updated: 0, skipped: true, formulaVersion: PRICING_CONFIG.formulaVersion };
  return calculatePlayerPrices(db, tournamentId, gameweek.id);
}
