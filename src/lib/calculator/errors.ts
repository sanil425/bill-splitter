export type CalculationErrorCode =
  /** An item's lineTotalCents is null. */
  | "UNREADABLE_PRICE"
  /** An item has no assignment, or one with no shares. */
  | "UNASSIGNED_ITEM"
  /** An assignment points at an item that isn't on any receipt. */
  | "UNKNOWN_ITEM"
  /** Two assignments for the same item. */
  | "DUPLICATE_ASSIGNMENT"
  /** A share or rule refers to a person who isn't in split.people. */
  | "UNKNOWN_PERSON"
  /** Two people or two items share an id. */
  | "DUPLICATE_ID"
  /** A weight is negative, zero where it must be positive, or not finite. */
  | "INVALID_WEIGHT"
  /** An amount is not a whole number of cents. */
  | "INVALID_AMOUNT"
  /** Nobody to put a non-zero amount on (e.g. a charge on a receipt with no items). */
  | "NO_PARTICIPANTS"
  /** A rule would push someone's total below zero. */
  | "NEGATIVE_TOTAL"
  /** Internal check failed: totals don't add up. Indicates a bug. */
  | "INVARIANT";

export type CalculationErrorDetails = {
  itemId?: string;
  receiptId?: string;
  personId?: string;
  ruleIndex?: number;
};

/**
 * Thrown when the calculator can't produce a correct breakdown. The validator
 * should catch these conditions first; this is the last line of defence so a
 * wrong number is never shown quietly.
 */
export class CalculationError extends Error {
  override readonly name = "CalculationError";

  constructor(
    readonly code: CalculationErrorCode,
    message: string,
    readonly details: CalculationErrorDetails = {},
  ) {
    super(message);
  }
}
