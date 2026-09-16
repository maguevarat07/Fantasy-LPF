export const PRICE_STEP_CENTS = 10_000_000; // $0.1M

export interface OwnershipPriceQuote {
  purchasePriceCents: number;
  currentPriceCents: number;
  sellingPriceCents: number;
  profitLossCents: number;
}

export function calculateSellingPriceCents(
  purchasePriceCents: number,
  currentPriceCents: number,
): number {
  if (!Number.isSafeInteger(purchasePriceCents) || purchasePriceCents < 0 ||
      !Number.isSafeInteger(currentPriceCents) || currentPriceCents < 0) {
    throw new RangeError('Los precios deben ser enteros no negativos expresados en centavos.');
  }
  if (currentPriceCents <= purchasePriceCents) return currentPriceCents;

  const appreciation = currentPriceCents - purchasePriceCents;
  const managerShare = Math.floor((appreciation / 2) / PRICE_STEP_CENTS) * PRICE_STEP_CENTS;
  return purchasePriceCents + managerShare;
}

export function ownershipPriceQuote(
  purchasePriceCents: number,
  currentPriceCents: number,
): OwnershipPriceQuote {
  const sellingPriceCents = calculateSellingPriceCents(purchasePriceCents, currentPriceCents);
  return {
    purchasePriceCents,
    currentPriceCents,
    sellingPriceCents,
    profitLossCents: sellingPriceCents - purchasePriceCents,
  };
}
