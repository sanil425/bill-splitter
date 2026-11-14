import { z } from "zod";

/** Opaque identifier (we generate UUIDs, but any non-empty string is valid). */
export const IdSchema = z.string().min(1);

/** Integer cents. May be negative (discounts, adjustments). */
export const CentsSchema = z.number().int();

/** Integer cents, zero or more. */
export const NonNegativeCentsSchema = CentsSchema.nonnegative();

/** Model confidence, 0 to 1 inclusive. */
export const ConfidenceSchema = z.number().min(0).max(1);

/** How a charge (tax, tip, service) is shared out. */
export const SplitMethodSchema = z.enum(["proportional", "equal"]);
export type SplitMethod = z.infer<typeof SplitMethodSchema>;

/** The charges on a receipt that are split separately from items. */
export const ChargeKindSchema = z.enum(["tax", "tip", "service"]);
export type ChargeKind = z.infer<typeof ChargeKindSchema>;

export const FlagSeveritySchema = z.enum(["blocking", "warning"]);
export type FlagSeverity = z.infer<typeof FlagSeveritySchema>;

/**
 * What a flag is about. Each validator check has its own code; MODEL_FLAG is
 * a note from the receipt parser or attribution model.
 */
export const FlagCodeSchema = z.enum([
  // Blocking, must fix
  "ITEM_NO_PRICE",
  "ITEM_UNASSIGNED",
  "HOST_MISSING",
  "RULE_UNKNOWN_PERSON",
  "RULE_SELF",
  "COVERAGE_OVER_100",
  "CHARGE_NO_ITEMS",
  "DUPLICATE_PERSON_ID",
  "DUPLICATE_ITEM_ID",
  "DUPLICATE_ASSIGNMENT",
  "ASSIGNMENT_UNKNOWN_ITEM",
  "SHARE_UNKNOWN_PERSON",
  "INVALID_WEIGHT",
  "INVALID_AMOUNT",
  "CALCULATION_FAILED",
  // Blocking, confirmable
  "SUBTOTAL_MISMATCH",
  // Warnings
  "UNREADABLE_LINE",
  "LOW_CONFIDENCE",
  "TOTAL_MISMATCH",
  "PERSON_NO_ITEMS",
  // From an AI model (severity set by the model; always confirmable)
  "MODEL_FLAG",
]);
export type FlagCode = z.infer<typeof FlagCodeSchema>;
