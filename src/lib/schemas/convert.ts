/**
 * Converters from (already parsed) AI responses to domain objects:
 * dollars -> cents, nulls -> undefined, names -> generated ids.
 * Outputs are re-checked against the domain schemas as a safety net.
 */
import { toCents } from "../money";
import type { AttributionResponse, ReceiptParseResponse } from "./ai";
import {
  AssignmentSchema,
  ChargeSettingsSchema,
  FlagSchema,
  PersonSchema,
  ReceiptSchema,
  RuleSchema,
  type ChargeSettings,
  type Receipt,
  type Rule,
  type Split,
} from "./domain";

export type IdGenerator = () => string;

const defaultNewId: IdGenerator = () => crypto.randomUUID();

const optionalCents = (dollars: number | null | undefined) =>
  dollars == null ? undefined : toCents(dollars);

export const DEFAULT_CHARGE_SETTINGS: ChargeSettings = {
  tax: "proportional",
  tip: "proportional",
  service: "proportional",
};

export function receiptFromAi(
  res: ReceiptParseResponse,
  opts: { receiptId?: string; newId?: IdGenerator } = {},
): Receipt {
  const newId = opts.newId ?? defaultNewId;
  const receiptId = opts.receiptId ?? newId();
  const merchant = res.merchant?.trim();

  return ReceiptSchema.parse({
    id: receiptId,
    merchant: merchant || undefined,
    items: res.items.map((item) => ({
      id: newId(),
      receiptId,
      name: item.name,
      rawText: item.rawText,
      unitPriceCents: toCents(item.unitPrice),
      quantity: item.quantity,
      confidence: item.confidence,
    })),
    subtotalCents: optionalCents(res.subtotal),
    taxCents: optionalCents(res.tax),
    tipCents: optionalCents(res.tip),
    serviceChargeCents: optionalCents(res.serviceCharge),
    totalCents: optionalCents(res.total),
    unreadableLines: res.unreadableLines,
  });
}

export type AttributionResult = Pick<Split, "people" | "assignments" | "rules" | "charges" | "flags">;

export function attributionFromAi(
  res: AttributionResponse,
  opts: { newId?: IdGenerator } = {},
): AttributionResult {
  const newId = opts.newId ?? defaultNewId;

  const people = res.people.map((p) =>
    PersonSchema.parse({ id: newId(), name: p.name, isHost: p.isHost ?? false }),
  );
  const idByName = new Map(people.map((p) => [p.name, p.id]));
  // The response schema guarantees every referenced name is in `people`.
  const idOf = (name: string) => idByName.get(name)!;

  const assignments = res.assignments.map((a) =>
    AssignmentSchema.parse({
      itemId: a.itemId,
      shares: Object.fromEntries(a.shares.map((s) => [idOf(s.person), s.weight])),
    }),
  );

  const rules = res.rules.map((r): Rule => {
    switch (r.type) {
      case "covers_fraction":
        return RuleSchema.parse({ ...r, payer: idOf(r.payer), beneficiary: idOf(r.beneficiary) });
      case "pays_charge":
        return RuleSchema.parse({ ...r, payer: idOf(r.payer) });
      case "pays_fixed":
        return RuleSchema.parse({ type: r.type, payer: idOf(r.payer), amountCents: toCents(r.amount) });
    }
  });

  const tipOverride = res.charges?.tipOverride;
  const charges = ChargeSettingsSchema.parse({
    tax: res.charges?.tax ?? DEFAULT_CHARGE_SETTINGS.tax,
    tip: res.charges?.tip ?? DEFAULT_CHARGE_SETTINGS.tip,
    service: res.charges?.service ?? DEFAULT_CHARGE_SETTINGS.service,
    tipOverride:
      tipOverride == null
        ? undefined
        : tipOverride.kind === "amount"
          ? { kind: "amount", value: toCents(tipOverride.value) }
          : tipOverride,
  });

  const flags = res.flags.map((f) =>
    FlagSchema.parse({
      id: newId(),
      severity: f.severity,
      source: "attribution",
      message: f.message,
      itemId: f.itemId ?? undefined,
      resolved: false,
    }),
  );

  return { people, assignments, rules, charges, flags };
}
