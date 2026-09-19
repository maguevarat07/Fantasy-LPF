import { describe, expect, it } from 'vitest';
import { moneyCents, nullableMoneyCents } from './money.js';

describe('normalización monetaria exacta', () => {
  it('acepta BIGINT, texto decimal entero e INTEGER sin perder centavos', () => {
    expect(moneyCents(6_500_000n, 'price')).toBe(6_500_000);
    expect(moneyCents('6500000', 'price')).toBe(6_500_000);
    expect(moneyCents(6_500_000, 'price')).toBe(6_500_000);
    expect(moneyCents('-10000000', 'profit', true)).toBe(-10_000_000);
    expect(nullableMoneyCents(null, 'optional')).toBeNull();
  });

  it.each([null, undefined, '-1', -1, '1.5', 1.5, NaN, Infinity, 'nope', '',
    '9007199254740992', 9_007_199_254_740_992, 9_007_199_254_740_992n,
  ])('rechaza un valor monetario no válido: %s', value => {
    expect(() => moneyCents(value, 'price')).toThrow(RangeError);
  });

  it('solo permite NULL y signos negativos cuando el llamador lo declara', () => {
    expect(nullableMoneyCents(undefined, 'optional')).toBeNull();
    expect(() => moneyCents(null, 'required')).toThrow(RangeError);
    expect(() => nullableMoneyCents('-5', 'unsigned')).toThrow(RangeError);
    expect(nullableMoneyCents('-5', 'signed', true)).toBe(-5);
  });
});
