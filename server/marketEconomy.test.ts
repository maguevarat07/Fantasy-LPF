import { describe, expect, it } from 'vitest';
import { calculateSellingPriceCents, ownershipPriceQuote } from './marketEconomy.js';

const MILLION = 100_000_000;

describe('market economy', () => {
  it('vende a 6.4M cuando se compró a 7.0M y el precio actual cayó a 6.4M', () => {
    expect(calculateSellingPriceCents(700_000_000, 640_000_000)).toBe(640_000_000);
  });

  it('entrega la mitad de la apreciación redondeada hacia abajo a $0.1M', () => {
    expect(calculateSellingPriceCents(5 * MILLION, 5.8 * MILLION)).toBe(5.4 * MILLION);
    expect(calculateSellingPriceCents(5 * MILLION, 5.95 * MILLION)).toBe(5.4 * MILLION);
  });

  it('traslada completamente la depreciación al precio de venta', () => {
    expect(ownershipPriceQuote(5 * MILLION, 4.2 * MILLION)).toEqual({
      purchasePriceCents: 5 * MILLION,
      currentPriceCents: 4.2 * MILLION,
      sellingPriceCents: 4.2 * MILLION,
      profitLossCents: -0.8 * MILLION,
    });
  });

  it('rechaza importes inválidos', () => {
    expect(() => calculateSellingPriceCents(-1, 5 * MILLION)).toThrow(RangeError);
    expect(() => calculateSellingPriceCents(5.5, 5 * MILLION)).toThrow(RangeError);
  });
});
