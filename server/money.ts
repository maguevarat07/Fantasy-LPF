/** Convert PostgreSQL BIGINT and SQLite INTEGER values to exact integer cents. */
export function moneyCents(value: unknown, field: string, allowNegative = false): number {
  let integer: bigint;
  if (typeof value === 'bigint') integer = value;
  else if (typeof value === 'string' && /^-?\d+$/.test(value)) integer = BigInt(value);
  else if (typeof value === 'number' && Number.isSafeInteger(value)) integer = BigInt(value);
  else throw new RangeError(`${field} debe ser un entero seguro expresado en centavos.`);

  if ((!allowNegative && integer < 0n) ||
      integer < BigInt(Number.MIN_SAFE_INTEGER) || integer > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${field} está fuera del rango monetario permitido.`);
  }
  return Number(integer);
}

export function nullableMoneyCents(value: unknown, field: string, allowNegative = false): number | null {
  return value == null ? null : moneyCents(value, field, allowNegative);
}
