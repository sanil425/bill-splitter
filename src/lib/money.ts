/**
 * All money in SplitIt is integer cents. Dollars (floats) only appear at the
 * edges: AI responses coming in, and formatted strings going out.
 */

/**
 * Convert a dollar amount to integer cents, rounding half a cent away from
 * zero (1.005 -> 101, -1.005 -> -101).
 *
 * `dollars * 100` alone is not enough: 1.005 * 100 === 100.49999999999999.
 * Rounding to 6 decimal places first removes that float noise before the
 * real rounding step.
 */
export function toCents(dollars: number): number {
  if (!Number.isFinite(dollars)) {
    throw new RangeError(`toCents: expected a finite number, got ${dollars}`);
  }
  const cents = Math.round(Number((Math.abs(dollars) * 100).toFixed(6)));
  return dollars < 0 && cents !== 0 ? -cents : cents;
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
