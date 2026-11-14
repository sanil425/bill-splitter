import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  AssignmentSchema,
  BreakdownSchema,
  ChargeSettingsSchema,
  FlagSchema,
  InputSchema,
  ItemSchema,
  PersonSchema,
  ReceiptSchema,
  RuleSchema,
  SplitSchema,
  type Breakdown,
  type Item,
  type Receipt,
  type Split,
} from "./domain";

const ok = (schema: z.ZodType, value: unknown) => expect(schema.safeParse(value).success).toBe(true);
const bad = (schema: z.ZodType, value: unknown) => expect(schema.safeParse(value).success).toBe(false);

const item: Item = {
  id: "i1",
  receiptId: "r1",
  name: "Margherita pizza",
  rawText: "1 MARGHERITA 14.50",
  lineTotalCents: 1450,
  unitPriceCents: 1450,
  quantity: 1,
  confidence: 0.97,
};

const receipt: Receipt = {
  id: "r1",
  merchant: "Luigi's",
  items: [item, { ...item, id: "i2", name: "Happy hour discount", rawText: "DISC -2.00", lineTotalCents: -200, unitPriceCents: undefined, quantity: undefined }],
  subtotalCents: 1250,
  taxCents: 111,
  tipCents: 250,
  totalCents: 1611,
  unreadableLines: ["##.## ??"],
};

const split: Split = {
  id: "s1",
  createdAt: "2026-11-14T19:30:00.000Z",
  hostId: "p1",
  people: [
    { id: "p1", name: "Sanil", isHost: true },
    { id: "p2", name: "Alex", isHost: false },
  ],
  receipts: [receipt],
  inputs: [
    { id: "in1", kind: "photo", receiptId: "r1" },
    { id: "in2", kind: "voice", transcript: "Alex and I shared the pizza" },
    { id: "in3", kind: "text", text: "I'll cover the tip" },
  ],
  assignments: [{ itemId: "i1", shares: { p1: 1, p2: 1 } }],
  rules: [{ type: "pays_charge", payer: "p1", charge: "tip" }],
  charges: { tax: "proportional", tip: "equal", service: "proportional" },
  flags: [],
};

const breakdown: Breakdown = {
  splitId: "s1",
  perPerson: [
    {
      personId: "p1",
      items: [{ itemId: "i1", amountCents: 725 }],
      taxCents: 56,
      tipCents: 250,
      serviceCents: 0,
      adjustmentsCents: 0,
      totalCents: 1031,
    },
  ],
  grandTotalCents: 1031,
};

describe("ItemSchema", () => {
  it("accepts a valid item, including discounts, unreadable prices and fractional quantity", () => {
    ok(ItemSchema, item);
    ok(ItemSchema, { ...item, lineTotalCents: -200, unitPriceCents: -200 });
    ok(ItemSchema, { ...item, lineTotalCents: null });
    ok(ItemSchema, { ...item, quantity: 0.5 });
    const { unitPriceCents: _u, quantity: _q, ...lineTotalOnly } = item;
    ok(ItemSchema, lineTotalOnly);
  });

  it("rejects malformed items", () => {
    bad(ItemSchema, { ...item, lineTotalCents: "$12" });
    bad(ItemSchema, { ...item, lineTotalCents: 12.5 }); // not whole cents
    bad(ItemSchema, { ...item, unitPriceCents: "$12" });
    bad(ItemSchema, { ...item, confidence: 1.2 });
    bad(ItemSchema, { ...item, confidence: -0.1 });
    bad(ItemSchema, { ...item, quantity: 0 });
    bad(ItemSchema, { ...item, name: "" });
    const { receiptId: _, ...noReceiptId } = item;
    bad(ItemSchema, noReceiptId);
    const { lineTotalCents: _l, ...noLineTotal } = item;
    bad(ItemSchema, noLineTotal); // must be present, even if null
  });
});

describe("ReceiptSchema", () => {
  it("accepts a valid receipt, with or without the optional totals", () => {
    ok(ReceiptSchema, receipt);
    ok(ReceiptSchema, { id: "r2", items: [], unreadableLines: [] });
  });

  it("rejects malformed receipts", () => {
    bad(ReceiptSchema, { ...receipt, totalCents: "$16.11" });
    bad(ReceiptSchema, { ...receipt, taxCents: -1 });
    bad(ReceiptSchema, { ...receipt, items: [{ ...item, lineTotalCents: "$12" }] });
    const { unreadableLines: _, ...noUnreadable } = receipt;
    bad(ReceiptSchema, noUnreadable);
  });
});

describe("PersonSchema", () => {
  it("accepts a valid person", () => ok(PersonSchema, { id: "p1", name: "Sanil", isHost: true }));

  it("rejects malformed people", () => {
    bad(PersonSchema, { id: "p1", name: "Sanil" });
    bad(PersonSchema, { id: "p1", name: "", isHost: false });
  });
});

describe("AssignmentSchema", () => {
  it("accepts weighted shares", () => ok(AssignmentSchema, { itemId: "i1", shares: { p1: 2, p2: 1, p3: 0.5 } }));

  it("rejects malformed assignments", () => {
    bad(AssignmentSchema, { itemId: "i1", shares: { p1: -1 } });
    bad(AssignmentSchema, { itemId: "i1", shares: { p1: 0 } });
    bad(AssignmentSchema, { itemId: "i1", shares: {} });
    bad(AssignmentSchema, { itemId: "i1", shares: { p1: "1" } });
    bad(AssignmentSchema, { shares: { p1: 1 } });
  });
});

describe("RuleSchema", () => {
  it("accepts each rule type", () => {
    ok(RuleSchema, { type: "covers_fraction", payer: "p1", beneficiary: "p2", fraction: 1 });
    ok(RuleSchema, { type: "covers_fraction", payer: "p1", beneficiary: "p2", fraction: 0.5 });
    ok(RuleSchema, { type: "pays_charge", payer: "p1", charge: "service" });
    ok(RuleSchema, { type: "pays_fixed", payer: "p1", amountCents: 0 });
  });

  it("rejects malformed rules", () => {
    bad(RuleSchema, { type: "covers_fraction", payer: "p1", beneficiary: "p2", fraction: 1.5 });
    bad(RuleSchema, { type: "covers_fraction", payer: "p1", beneficiary: "p2", fraction: 0 });
    bad(RuleSchema, { type: "covers_fraction", payer: "p1", fraction: 0.5 });
    bad(RuleSchema, { type: "pays_charge", payer: "p1", charge: "drinks" });
    bad(RuleSchema, { type: "pays_fixed", payer: "p1", amountCents: -100 });
    bad(RuleSchema, { type: "pays_fixed", payer: "p1", amountCents: "$20" });
    bad(RuleSchema, { type: "splits_evenly", payer: "p1" });
  });
});

describe("ChargeSettingsSchema", () => {
  const charges = { tax: "proportional", tip: "equal", service: "proportional" };

  it("accepts settings with and without a tip override", () => {
    ok(ChargeSettingsSchema, charges);
    ok(ChargeSettingsSchema, { ...charges, tipOverride: { kind: "percent", value: 18 } });
    ok(ChargeSettingsSchema, { ...charges, tipOverride: { kind: "amount", value: 2000 } });
  });

  it("rejects malformed settings", () => {
    bad(ChargeSettingsSchema, { ...charges, tax: "by_weight" });
    bad(ChargeSettingsSchema, { tax: "proportional", tip: "equal" });
    bad(ChargeSettingsSchema, { ...charges, tipOverride: { kind: "percent", value: -5 } });
    bad(ChargeSettingsSchema, { ...charges, tipOverride: { kind: "amount", value: 20.5 } });
    bad(ChargeSettingsSchema, { ...charges, tipOverride: { kind: "vibes", value: 1 } });
  });
});

describe("FlagSchema", () => {
  const flag = {
    id: "SUBTOTAL_MISMATCH:r1",
    code: "SUBTOTAL_MISMATCH",
    severity: "blocking",
    confirmable: true,
    source: "validator",
    message: "Items don't add up",
    resolved: false,
  };

  it("accepts a valid flag", () => {
    ok(FlagSchema, flag);
    ok(FlagSchema, { ...flag, itemId: "i1", receiptId: "r1" });
  });

  it("rejects malformed flags", () => {
    bad(FlagSchema, { ...flag, severity: "critical" });
    bad(FlagSchema, { ...flag, source: "user" });
    bad(FlagSchema, { ...flag, code: "SOMETHING_ELSE" });
    const { code: _c, ...noCode } = flag;
    bad(FlagSchema, noCode);
    const { confirmable: _k, ...noConfirmable } = flag;
    bad(FlagSchema, noConfirmable);
    bad(FlagSchema, { ...flag, message: "" });
    const { resolved: _, ...noResolved } = flag;
    bad(FlagSchema, noResolved);
  });
});

describe("InputSchema", () => {
  it("accepts each input kind", () => split.inputs.forEach((input) => ok(InputSchema, input)));

  it("rejects malformed inputs", () => {
    bad(InputSchema, { id: "in1", kind: "video" });
    bad(InputSchema, { id: "in1", kind: "text" });
  });
});

describe("SplitSchema", () => {
  it("accepts a valid split", () => ok(SplitSchema, split));

  it("rejects malformed splits", () => {
    bad(SplitSchema, { ...split, createdAt: "last Tuesday" });
    bad(SplitSchema, { ...split, rules: [{ type: "unknown_rule", payer: "p1" }] });
    bad(SplitSchema, { ...split, assignments: [{ itemId: "i1", shares: { p1: -1 } }] });
    const { charges: _, ...noCharges } = split;
    bad(SplitSchema, noCharges);
  });
});

describe("BreakdownSchema", () => {
  it("accepts a valid breakdown, including negative adjustments", () => {
    ok(BreakdownSchema, breakdown);
    ok(BreakdownSchema, { ...breakdown, perPerson: [{ ...breakdown.perPerson[0], adjustmentsCents: -500 }] });
  });

  it("rejects malformed breakdowns", () => {
    bad(BreakdownSchema, { ...breakdown, grandTotalCents: 10.31 });
    bad(BreakdownSchema, { ...breakdown, perPerson: [{ ...breakdown.perPerson[0], totalCents: "$10.31" }] });
    const { splitId: _, ...noSplitId } = breakdown;
    bad(BreakdownSchema, noSplitId);
  });
});
