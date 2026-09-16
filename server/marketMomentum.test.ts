import { describe, expect, it } from 'vitest';
import { applyMarketPressure, PRICING_CONFIG } from './pricingEngine.js';
import {
  calculateMarketMomentum,
  DEFAULT_MARKET_MOMENTUM_CONFIG,
  marketMomentumConfigFromEnv,
  type MarketMomentumConfig,
  type MarketTransferEvent,
} from './marketMomentum.js';

const end = '2026-05-02T00:00:00.000Z';
const oldManager = '2026-04-01T00:00:00.000Z';
const config = (overrides: Partial<MarketMomentumConfig> = {}): MarketMomentumConfig => ({
  ...DEFAULT_MARKET_MOMENTUM_CONFIG,
  enabled: true,
  ...overrides,
});
const event = (overrides: Partial<MarketTransferEvent> = {}): MarketTransferEvent => ({
  fantasyTeamId: 'team-1',
  playerOutId: 'out',
  playerInId: 'in',
  createdAt: '2026-05-01T12:00:00.000Z',
  managerCreatedAt: oldManager,
  status: 'CONFIRMED',
  origin: 'USER',
  revertedAt: null,
  wildcardUsed: false,
  ...overrides,
});

describe('Market Momentum', () => {
  it('queda completamente desactivado por feature flag', () => {
    const result = calculateMarketMomentum(1_000, [event()], end, config({ enabled: false }));
    expect(result.enabled).toBe(false);
    expect(result.players.size).toBe(0);
  });

  it('aplica protección para mercados con menos de 500 managers', () => {
    const result = calculateMarketMomentum(499, Array.from({ length: 100 }, (_, index) => event({ fantasyTeamId: `t-${index}` })), end, config());
    expect(result.marketScale).toBe(0);
    expect(result.players.size).toBe(0);
  });

  it('escala entre 500 y 1,000 managers y limita la presión a ±$0.1M', () => {
    const events = Array.from({ length: 100 }, (_, index) => event({ fantasyTeamId: `t-${index}` }));
    const partial = calculateMarketMomentum(750, events, end, config());
    const full = calculateMarketMomentum(1_000, events, end, config());
    expect(partial.marketScale).toBeCloseTo(0.5);
    expect(full.marketScale).toBe(1);
    expect(partial.players.get('in')?.pricePressureCents).toBe(10_000_000);
    expect(full.players.get('in')?.pricePressureCents).toBe(10_000_000);
    expect(full.players.get('out')?.pricePressureCents).toBe(-10_000_000);
  });

  it('excluye operaciones no confirmadas, no comerciales, revertidas y cuentas demasiado nuevas', () => {
    const valid = event({ fantasyTeamId: 'valid' });
    const excluded = [
      event({ fantasyTeamId: 'pending', status: 'PENDING' }),
      event({ fantasyTeamId: 'initial', origin: 'INITIAL_SQUAD' }),
      event({ fantasyTeamId: 'bench', origin: 'BENCH' }),
      event({ fantasyTeamId: 'seed', origin: 'SEED' }),
      event({ fantasyTeamId: 'test', origin: 'TEST' }),
      event({ fantasyTeamId: 'admin', origin: 'ADMIN' }),
      event({ fantasyTeamId: 'reverted', revertedAt: '2026-05-01T13:00:00.000Z' }),
      event({ fantasyTeamId: 'new', managerCreatedAt: '2026-05-01T12:30:00.000Z' }),
    ];
    const result = calculateMarketMomentum(1_000, [valid, ...excluded], end, config({ minimumWindowTransfers: 1 }));
    expect(result.qualifyingWindowTransfers).toBe(1);
    expect(result.players.get('in')?.transfersIn).toBe(1);
  });

  it('reduce Comodín al 25% y normaliza el neto por equipos activos', () => {
    const neutral = Array.from({ length: 99 }, (_, index) => event({
      fantasyTeamId: `neutral-${index}`,
      playerOutId: `a-${index}`,
      playerInId: `b-${index}`,
    }));
    const wildcard = event({ fantasyTeamId: 'wildcard', playerInId: 'target', wildcardUsed: true });
    const regular = event({ fantasyTeamId: 'regular', playerInId: 'target' });
    const result = calculateMarketMomentum(1_000, [...neutral, wildcard, regular], end, config());
    const target = result.players.get('target')!;
    expect(target.transfersIn).toBe(2);
    expect(target.weightedTransfersIn).toBe(1.25);
    expect(target.normalizedNetRate).toBeCloseTo(0.00125);
  });

  it('detecta y excluye actividad masiva de un mismo equipo', () => {
    const abusive = Array.from({ length: 16 }, (_, index) => event({
      fantasyTeamId: 'bot-team', playerOutId: `out-${index}`, playerInId: 'target',
    }));
    const legitimate = event({ fantasyTeamId: 'legitimate', playerInId: 'target' });
    const result = calculateMarketMomentum(1_000, [...abusive, legitimate], end, config({ minimumWindowTransfers: 1 }));
    expect(result.anomalousTeamIds).toEqual(['bot-team']);
    expect(result.qualifyingWindowTransfers).toBe(1);
    expect(result.players.get('target')?.transfersIn).toBe(1);
  });

  it('impide que un equipo multiplique la señal comprando y vendiendo repetidamente al mismo jugador', () => {
    const churn = [
      event({ fantasyTeamId: 'churn', playerOutId: 'a', playerInId: 'target' }),
      event({ fantasyTeamId: 'churn', playerOutId: 'target', playerInId: 'b' }),
      event({ fantasyTeamId: 'churn', playerOutId: 'c', playerInId: 'target' }),
    ];
    const result = calculateMarketMomentum(1_000, churn, end, config({ minimumWindowTransfers: 1 }));
    const target = result.players.get('target')!;
    expect(target.transfersIn).toBe(2);
    expect(target.transfersOut).toBe(1);
    expect(target.weightedTransfersIn).toBe(1);
    expect(target.weightedTransfersOut).toBe(0);
    expect(target.normalizedNetRate).toBeCloseTo(0.001);
  });

  it('respeta el cap total de movimiento del Pricing Engine', () => {
    const marketConfig = config();
    const pricingConfig = { ...PRICING_CONFIG, marketMomentumEnabled: true, marketMomentumConfig: marketConfig };
    expect(applyMarketPressure(630_000_000, 600_000_000, 10_000_000, { min: 500_000_000, max: 900_000_000 }, pricingConfig)).toBe(630_000_000);
    expect(applyMarketPressure(620_000_000, 600_000_000, 10_000_000, { min: 500_000_000, max: 900_000_000 }, pricingConfig)).toBe(630_000_000);
    expect(applyMarketPressure(580_000_000, 600_000_000, -10_000_000, { min: 500_000_000, max: 900_000_000 }, pricingConfig)).toBe(570_000_000);
  });

  it('lee el feature flag y conserva defaults seguros ante valores inválidos', () => {
    const loaded = marketMomentumConfigFromEnv({
      MARKET_MOMENTUM_ENABLED: 'true',
      MARKET_MOMENTUM_MIN_ACTIVE_MANAGERS: 'invalid',
      MARKET_MOMENTUM_MAX_IMPACT_CENTS: '10000000',
    });
    expect(loaded.enabled).toBe(true);
    expect(loaded.minimumActiveManagers).toBe(500);
    expect(loaded.maxPriceImpactCents).toBe(10_000_000);
  });
});
