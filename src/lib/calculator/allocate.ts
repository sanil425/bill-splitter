import { CalculationError } from "./errors";

/** Weights are scaled to integers with this precision so all maths is exact. */
const WEIGHT_SCALE = 1_000_000;

/**
 * Split an integer number of cents into integers in proportion to `weights`,
 * using the largest-remainder method. The result always adds up exactly to
 * `totalCents`.
 *
 * - Leftover cents go to the largest remainders; ties go to the lowest index,
 *   so callers control tie-breaking by the order of `weights`.
 * - A zero weight always gets 0.
 * - Negative totals are split as the mirror image of the positive total.
 *
 * Throws CalculationError if a weight is negative or not finite, or if
 * `totalCents` is non-zero and every weight is zero.
 */
export function allocate(totalCents: number, weights: readonly number[]): number[] {
  if (!Number.isSafeInteger(totalCents)) {
    throw new CalculationError("INVALID_AMOUNT", `allocate: ${totalCents} is not a whole number of cents`);
  }
  for (const w of weights) {
    if (!Number.isFinite(w) || w < 0) {
      throw new CalculationError("INVALID_WEIGHT", `allocate: invalid weight ${w}`);
    }
  }
  if (totalCents === 0) return weights.map(() => 0);

  // Exact integer arithmetic: scale weights to integers, then use BigInt so
  // total * weight can't overflow or lose precision.
  const scaled = weights.map((w) => BigInt(Math.round(w * WEIGHT_SCALE)));
  const sum = scaled.reduce((a, b) => a + b, BigInt(0));
  if (sum === BigInt(0)) {
    throw new CalculationError("NO_PARTICIPANTS", `allocate: cannot split ${totalCents} with all-zero weights`);
  }

  const abs = BigInt(Math.abs(totalCents));
  const floors = scaled.map((w) => (abs * w) / sum);
  const remainders = scaled.map((w) => (abs * w) % sum);
  const leftover = Number(abs - floors.reduce((a, b) => a + b, BigInt(0)));

  // Largest remainder first; ties by index. Zero weights have remainder 0 and
  // there are always fewer leftover cents than positive remainders, so a zero
  // weight never receives a cent.
  const order = weights
    .map((_, i) => i)
    .sort((i, j) => (remainders[j] > remainders[i] ? 1 : remainders[j] < remainders[i] ? -1 : i - j));

  const result = floors.map(Number);
  for (let k = 0; k < leftover; k++) result[order[k]] += 1;

  return totalCents < 0 ? result.map((c) => (c === 0 ? 0 : -c)) : result;
}
