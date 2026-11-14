/**
 * AI response schemas: what the models return. Prices are dollars (numbers,
 * never strings). Optional fields accept null as well as missing, since
 * models often emit explicit nulls. Convert to domain objects with the
 * functions in ./convert.ts.
 */
import { z } from "zod";
import { ChargeKindSchema, ConfidenceSchema, FlagSeveritySchema, IdSchema, SplitMethodSchema } from "./common";

const DollarsSchema = z.number();
const NonNegativeDollarsSchema = z.number().nonnegative();
const NameSchema = z.string().trim().min(1);

// ---------------------------------------------------------------------------
// Receipt parsing (vision model, one photo)

export const ReceiptParseItemSchema = z.object({
  name: NameSchema,
  rawText: z.string(),
  /** Total for the line, in dollars. Negative for discounts; null if unreadable. */
  lineTotal: DollarsSchema.nullable(),
  /** Display only: unit price in dollars, if printed. */
  unitPrice: DollarsSchema.nullish(),
  /** Display only. */
  quantity: z.number().positive().nullish(),
  confidence: ConfidenceSchema,
});
export type ReceiptParseItem = z.infer<typeof ReceiptParseItemSchema>;

export const ReceiptParseResponseSchema = z.object({
  merchant: z.string().nullish(),
  items: z.array(ReceiptParseItemSchema),
  subtotal: DollarsSchema.nullish(),
  tax: NonNegativeDollarsSchema.nullish(),
  tip: NonNegativeDollarsSchema.nullish(),
  serviceCharge: NonNegativeDollarsSchema.nullish(),
  total: DollarsSchema.nullish(),
  /** Text that can't be tied to any item. */
  unreadableLines: z.array(z.string()).default([]),
});
export type ReceiptParseResponse = z.infer<typeof ReceiptParseResponseSchema>;

// ---------------------------------------------------------------------------
// Attribution (one call over all receipts + notes)
// People are referenced by name; the converter maps names to ids.

export const AiPersonSchema = z.object({
  name: NameSchema,
  isHost: z.boolean().optional(),
});

export const AiAssignmentSchema = z.object({
  /** Id of an item we sent to the model. */
  itemId: IdSchema,
  shares: z.array(z.object({ person: NameSchema, weight: z.number().positive() })).min(1),
});

export const AiRuleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("covers_fraction"),
    payer: NameSchema,
    beneficiary: NameSchema,
    fraction: z.number().gt(0).lte(1),
  }),
  z.object({ type: z.literal("pays_charge"), payer: NameSchema, charge: ChargeKindSchema }),
  z.object({ type: z.literal("pays_fixed"), payer: NameSchema, amount: NonNegativeDollarsSchema }),
]);
export type AiRule = z.infer<typeof AiRuleSchema>;

export const AiChargeSettingsSchema = z.object({
  tax: SplitMethodSchema.nullish(),
  tip: SplitMethodSchema.nullish(),
  service: SplitMethodSchema.nullish(),
  /** `percent` value is e.g. 18 for 18%; `amount` value is dollars. */
  tipOverride: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("percent"), value: z.number().min(0).max(100) }),
      z.object({ kind: z.literal("amount"), value: NonNegativeDollarsSchema }),
    ])
    .nullish(),
});

export const AiFlagSchema = z.object({
  severity: FlagSeveritySchema,
  message: z.string().min(1),
  itemId: IdSchema.nullish(),
});

export const AttributionResponseSchema = z
  .object({
    people: z.array(AiPersonSchema).min(1),
    assignments: z.array(AiAssignmentSchema),
    rules: z.array(AiRuleSchema).default([]),
    charges: AiChargeSettingsSchema.nullish(),
    flags: z.array(AiFlagSchema).default([]),
  })
  .superRefine((res, ctx) => {
    const names = new Set<string>();
    res.people.forEach((p, i) => {
      if (names.has(p.name)) {
        ctx.addIssue({ code: "custom", message: `Duplicate person "${p.name}"`, path: ["people", i, "name"] });
      }
      names.add(p.name);
    });

    const checkName = (name: string, path: (string | number)[]) => {
      if (!names.has(name)) {
        ctx.addIssue({ code: "custom", message: `Unknown person "${name}"`, path });
      }
    };

    res.assignments.forEach((a, i) => {
      const seen = new Set<string>();
      a.shares.forEach((s, j) => {
        const path = ["assignments", i, "shares", j, "person"];
        checkName(s.person, path);
        if (seen.has(s.person)) {
          ctx.addIssue({ code: "custom", message: `"${s.person}" listed twice for one item`, path });
        }
        seen.add(s.person);
      });
    });

    res.rules.forEach((r, i) => {
      checkName(r.payer, ["rules", i, "payer"]);
      if (r.type === "covers_fraction") checkName(r.beneficiary, ["rules", i, "beneficiary"]);
    });
  });
export type AttributionResponse = z.infer<typeof AttributionResponseSchema>;
