/**
 * Domain schemas: what the app stores and calculates with. All money is
 * integer cents. These check shape only; cross-references (e.g. an
 * assignment pointing at a real item) are the validator's job.
 */
import { z } from "zod";
import {
  CentsSchema,
  ChargeKindSchema,
  ConfidenceSchema,
  FlagCodeSchema,
  FlagSeveritySchema,
  IdSchema,
  NonNegativeCentsSchema,
  SplitMethodSchema,
} from "./common";

export const ItemSchema = z.object({
  id: IdSchema,
  receiptId: IdSchema,
  name: z.string().min(1),
  /** The line as printed on the receipt (empty for typed-in items). */
  rawText: z.string(),
  /**
   * What this line costs in total. The ONLY number the maths uses.
   * Negative for discounts; null when the price couldn't be read.
   */
  lineTotalCents: CentsSchema.nullable(),
  /** Display only. Price of one unit, if the receipt shows it. */
  unitPriceCents: CentsSchema.optional(),
  /** Display only. Fractions (e.g. 0.5 lb) are allowed. */
  quantity: z.number().positive().optional(),
  confidence: ConfidenceSchema,
});
export type Item = z.infer<typeof ItemSchema>;

export const ReceiptSchema = z.object({
  id: IdSchema,
  merchant: z.string().min(1).optional(),
  items: z.array(ItemSchema),
  subtotalCents: CentsSchema.optional(),
  taxCents: NonNegativeCentsSchema.optional(),
  tipCents: NonNegativeCentsSchema.optional(),
  serviceChargeCents: NonNegativeCentsSchema.optional(),
  totalCents: CentsSchema.optional(),
  /** Raw text the vision model couldn't tie to any item. */
  unreadableLines: z.array(z.string()),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

export const PersonSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  isHost: z.boolean(),
});
export type Person = z.infer<typeof PersonSchema>;

/** personId -> weight. A person with weight 2 pays twice the share of weight 1. */
export const SharesSchema = z
  .record(IdSchema, z.number().positive())
  .refine((shares) => Object.keys(shares).length > 0, {
    message: "An assignment needs at least one person",
  });
export type Shares = z.infer<typeof SharesSchema>;

export const AssignmentSchema = z.object({
  itemId: IdSchema,
  shares: SharesSchema,
});
export type Assignment = z.infer<typeof AssignmentSchema>;

export const CoversFractionRuleSchema = z.object({
  type: z.literal("covers_fraction"),
  payer: IdSchema,
  beneficiary: IdSchema,
  /** Fraction of the beneficiary's total the payer covers, in (0, 1]. */
  fraction: z.number().gt(0).lte(1),
});

export const PaysChargeRuleSchema = z.object({
  type: z.literal("pays_charge"),
  payer: IdSchema,
  charge: ChargeKindSchema,
});

export const PaysFixedRuleSchema = z.object({
  type: z.literal("pays_fixed"),
  payer: IdSchema,
  amountCents: NonNegativeCentsSchema,
});

export const RuleSchema = z.discriminatedUnion("type", [
  CoversFractionRuleSchema,
  PaysChargeRuleSchema,
  PaysFixedRuleSchema,
]);
export type Rule = z.infer<typeof RuleSchema>;
export type CoversFractionRule = z.infer<typeof CoversFractionRuleSchema>;
export type PaysChargeRule = z.infer<typeof PaysChargeRuleSchema>;
export type PaysFixedRule = z.infer<typeof PaysFixedRuleSchema>;

/** Replaces the receipt's tip. `percent` value is e.g. 18 for 18%; `amount` value is cents. */
export const TipOverrideSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("percent"), value: z.number().min(0).max(100) }),
  z.object({ kind: z.literal("amount"), value: NonNegativeCentsSchema }),
]);
export type TipOverride = z.infer<typeof TipOverrideSchema>;

export const ChargeSettingsSchema = z.object({
  tax: SplitMethodSchema,
  tip: SplitMethodSchema,
  service: SplitMethodSchema,
  tipOverride: TipOverrideSchema.optional(),
});
export type ChargeSettings = z.infer<typeof ChargeSettingsSchema>;

export const FlagSchema = z.object({
  /**
   * Deterministic for validator flags: code + the ids involved
   * (e.g. "ITEM_NO_PRICE:item_3"), so resolved state survives re-validation.
   */
  id: IdSchema,
  code: FlagCodeSchema,
  severity: FlagSeveritySchema,
  /**
   * Whether the user may mark it resolved without changing the split
   * ("yes, the receipt total really is off"). Blocking flags with
   * confirmable: false must be fixed. Warnings can always be dismissed.
   */
  confirmable: z.boolean(),
  source: z.enum(["receipt", "attribution", "validator"]),
  message: z.string().min(1),
  itemId: IdSchema.optional(),
  receiptId: IdSchema.optional(),
  resolved: z.boolean(),
});
export type Flag = z.infer<typeof FlagSchema>;

/** What the host gave us. Photos become receipts; voice and text feed attribution. */
export const InputSchema = z.discriminatedUnion("kind", [
  /** receiptId is set once parsed; thumbnail is a small JPEG data URL (the full photo isn't stored). */
  z.object({ id: IdSchema, kind: z.literal("photo"), receiptId: IdSchema.optional(), thumbnail: z.string().optional() }),
  /** An empty transcript means it hasn't been transcribed yet. */
  z.object({ id: IdSchema, kind: z.literal("voice"), transcript: z.string() }),
  z.object({ id: IdSchema, kind: z.literal("text"), text: z.string() }),
]);
export type Input = z.infer<typeof InputSchema>;

export const SplitSchema = z.object({
  id: IdSchema,
  createdAt: z.iso.datetime(),
  /** Person id of the host (who also has isHost: true in people). */
  hostId: IdSchema,
  people: z.array(PersonSchema),
  receipts: z.array(ReceiptSchema),
  inputs: z.array(InputSchema),
  assignments: z.array(AssignmentSchema),
  rules: z.array(RuleSchema),
  charges: ChargeSettingsSchema,
  flags: z.array(FlagSchema),
});
export type Split = z.infer<typeof SplitSchema>;

export const PersonBreakdownSchema = z.object({
  personId: IdSchema,
  items: z.array(z.object({ itemId: IdSchema, amountCents: CentsSchema })),
  taxCents: CentsSchema,
  tipCents: CentsSchema,
  serviceCents: CentsSchema,
  /** Net effect of custom rules (+ pays more, - pays less). */
  adjustmentsCents: CentsSchema,
  totalCents: CentsSchema,
});
export type PersonBreakdown = z.infer<typeof PersonBreakdownSchema>;

export const BreakdownSchema = z.object({
  splitId: IdSchema,
  perPerson: z.array(PersonBreakdownSchema),
  grandTotalCents: CentsSchema,
});
export type Breakdown = z.infer<typeof BreakdownSchema>;
