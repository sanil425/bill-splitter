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
