import { describe, expect, it } from "vitest";
import { AttributionResponseSchema, ReceiptParseResponseSchema } from "./ai";
import { attributionResponse, receiptResponse } from "./test-fixtures";
import { attributionFromAi, receiptFromAi } from "./convert";
import { ReceiptSchema, SplitSchema } from "./domain";

/** Deterministic ids: id1, id2, ... */
const counter = () => {
  let n = 0;
  return () => `id${++n}`;
};

describe("receiptFromAi", () => {
  const parsed = ReceiptParseResponseSchema.parse(receiptResponse);

  it("converts dollars to cents and generates ids", () => {
    const receipt = receiptFromAi(parsed, { receiptId: "r1", newId: counter() });

    expect(receipt).toEqual({
      id: "r1",
      merchant: "Luigi's",
      items: [
        { id: "id1", receiptId: "r1", name: "Margherita pizza", rawText: "MARGHERITA 14.50", lineTotalCents: 1450, confidence: 0.97 },
        { id: "id2", receiptId: "r1", name: "Beer", rawText: "2 IPA @ 7.25 14.50", lineTotalCents: 1450, unitPriceCents: 725, quantity: 2, confidence: 0.9 },
        { id: "id3", receiptId: "r1", name: "Wings", rawText: "3 WINGS FOR 10.00", lineTotalCents: 1000, quantity: 3, confidence: 0.85 },
        { id: "id4", receiptId: "r1", name: "Discount", rawText: "HH DISC -2.00", lineTotalCents: -200, confidence: 0.8 },
        { id: "id5", receiptId: "r1", name: "Dessert", rawText: "TIRAMISU ##.##", lineTotalCents: null, confidence: 0.3 },
      ],
      subtotalCents: 3700,
      taxCents: 329,
      totalCents: 4029,
      unreadableLines: ["THANK Y0U ##"],
    });
    expect(receipt.tipCents).toBeUndefined();
    expect(receipt.serviceChargeCents).toBeUndefined();
  });

  it("keeps an unreadable price as null and leaves display-only fields out when absent", () => {
    const receipt = receiptFromAi(parsed, { newId: counter() });
    const [pizza, , wings, , dessert] = receipt.items;
    expect(dessert.lineTotalCents).toBeNull();
    expect(pizza.unitPriceCents).toBeUndefined();
    expect(pizza.quantity).toBeUndefined();
    expect(wings.unitPriceCents).toBeUndefined(); // null from the model -> undefined
  });

  it("generates a receipt id when none is given", () => {
    const receipt = receiptFromAi(parsed, { newId: counter() });
    expect(receipt.id).toBe("id1");
    expect(receipt.items.every((i) => i.receiptId === "id1")).toBe(true);
  });

  it("uses random UUIDs by default", () => {
    const receipt = receiptFromAi(parsed);
    expect(receipt.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(receipt.items.map((i) => i.id)).size).toBe(5);
  });

  it("drops a blank merchant and produces a valid domain receipt", () => {
    const receipt = receiptFromAi(ReceiptParseResponseSchema.parse({ merchant: "  ", items: [] }));
    expect(receipt.merchant).toBeUndefined();
    expect(ReceiptSchema.safeParse(receipt).success).toBe(true);
  });
});

describe("attributionFromAi", () => {
  const parsed = AttributionResponseSchema.parse(attributionResponse);
  const result = attributionFromAi(parsed, { newId: counter() });

  it("creates people with ids, defaulting isHost to false", () => {
    expect(result.people).toEqual([
      { id: "id1", name: "Sanil", isHost: true },
      { id: "id2", name: "Alex", isHost: false },
      { id: "id3", name: "Jo", isHost: false },
    ]);
  });

  it("maps share names to person ids", () => {
    expect(result.assignments).toEqual([
      { itemId: "i1", shares: { id1: 1, id2: 1 } },
      { itemId: "i2", shares: { id3: 2, id2: 1 } },
    ]);
  });

  it("maps rule names to ids and fixed amounts to cents", () => {
    expect(result.rules).toEqual([
      { type: "covers_fraction", payer: "id1", beneficiary: "id3", fraction: 0.5 },
      { type: "pays_charge", payer: "id2", charge: "tip" },
      { type: "pays_fixed", payer: "id3", amountCents: 1001 },
    ]);
  });

  it("fills missing charge settings with proportional and converts a tip amount to cents", () => {
    expect(result.charges).toEqual({
      tax: "proportional",
      tip: "equal",
      service: "proportional",
      tipOverride: { kind: "amount", value: 600 },
    });
  });

  it("keeps a percent tip override as a percent", () => {
    const res = AttributionResponseSchema.parse({
      ...attributionResponse,
      charges: { tipOverride: { kind: "percent", value: 18 } },
    });
    expect(attributionFromAi(res).charges.tipOverride).toEqual({ kind: "percent", value: 18 });
  });

  it("defaults all charges to proportional when the model gives none", () => {
    const res = AttributionResponseSchema.parse({ people: [{ name: "Sanil" }], assignments: [] });
    expect(attributionFromAi(res).charges).toEqual({ tax: "proportional", tip: "proportional", service: "proportional" });
  });

  it("turns model flags into unresolved attribution flags", () => {
    expect(result.flags).toEqual([
      { id: "id4", severity: "warning", source: "attribution", message: "Not sure who had the beer", itemId: "i2", resolved: false },
    ]);
  });

  it("produces data that fits into a valid Split", () => {
    const receipt = receiptFromAi(ReceiptParseResponseSchema.parse(receiptResponse));
    const split = {
      id: "s1",
      createdAt: new Date().toISOString(),
      hostId: result.people[0].id,
      receipts: [receipt],
      inputs: [{ id: "in1", kind: "text", text: "Sanil and Alex split the pizza" }],
      ...result,
    };
    expect(SplitSchema.safeParse(split).success).toBe(true);
  });
});
