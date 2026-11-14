/**
 * All money in SplitIt is integer cents. Dollars (floats) only appear at the
 * edges: AI responses coming in, and formatted strings going out.
 */

/**
 * Round to the nearest integer, halves away from zero (2.5 -> 3, -2.5 -> -3).
 * Never returns -0.
 *
 * Float noise is removed first (rounding to 6 decimal places), because
 * e.g. 1.005 * 100 === 100.49999999999999 should count as a half.
 */
export function roundHalfAwayFromZero(x: number): number {
  const r = Math.round(Number(Math.abs(x).toFixed(6)));
  return x < 0 && r !== 0 ? -r : r;
}

/**
 * Convert a dollar amount to integer cents, rounding half a cent away from
 * zero (1.005 -> 101, -1.005 -> -101).
 */
export function toCents(dollars: number): number {
  if (!Number.isFinite(dollars)) {
    throw new RangeError(`toCents: expected a finite number, got ${dollars}`);
  }
  return roundHalfAwayFromZero(dollars * 100);
}

/** Format integer cents as US dollars: 1250 -> "$12.50", -99 -> "-$0.99". */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`formatCents: expected integer cents, got ${cents}`);
  }
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const rest = String(abs % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}$${dollars}.${rest}`;
}
