import { describe, expect, it } from "vitest";
import type { Receipt } from "../../src/lib/schemas";
import { ExpectedReceiptSchema, compareReceipt, toExpected } from "./compare";

const item = (name: string, lineTotalCents: number | null) => ({ id: name, receiptId: "r", name, rawText: name, lineTotalCents, confidence: 0.9 });

const receipt: Receipt = {
  id: "r",
  merchant: "Osushi",
  items: [item("Salmon Roll", 1200), item("Miso Soup", 400), item("Discount", -200)],
  subtotalCents: 1400,
  taxCents: 120,
  totalCents: 1520,
  unreadableLines: [],
};

describe("compareReceipt", () => {
  it("passes its own expected output, which round-trips through the schema", () => {
    const expected = ExpectedReceiptSchema.parse(JSON.parse(JSON.stringify(toExpected(receipt))));
    expect(expected.tipCents).toBeNull();
    expect(compareReceipt(receipt, expected)).toEqual({ diffs: [], notes: [] });
  });

  it("ignores item order and only notes name differences", () => {
    const expected = toExpected(receipt);
    expected.items = [{ name: "Miso", lineTotalCents: 400 }, ...expected.items.filter((i) => i.lineTotalCents !== 400)];
    const { diffs, notes } = compareReceipt(receipt, expected);
    expect(diffs).toEqual([]);
    expect(notes).toEqual(['"Miso" was named "Miso Soup"']);
  });

  it("fails on wrong amounts, missing or extra items, and charges", () => {
    const actual: Receipt = { ...receipt, items: [item("Salmon Roll", 1300), item("Miso Soup", null)], tipCents: 300, taxCents: undefined };
    const { diffs } = compareReceipt(actual, toExpected(receipt));
    expect(diffs).toEqual([
      "items: expected 3, got 2",
      'item "Salmon Roll" 12.00: no item with that line total',
      'item "Miso Soup" 4.00: no item with that line total',
      'item "Discount" -2.00: no item with that line total',
      'unexpected item "Salmon Roll" 13.00',
      'unexpected item "Miso Soup" none',
      "taxCents: expected 1.20, got none",
      "tipCents: expected none, got 3.00",
    ]);
  });

  it("skips charges missing from the expected file", () => {
    const { subtotalCents: _, taxCents: __, ...partial } = toExpected(receipt);
    expect(compareReceipt({ ...receipt, taxCents: 999, subtotalCents: 1 }, partial).diffs).toEqual([]);
  });
});
