import { describe, expect, it } from "vitest";
import { AttributionResponseSchema, ReceiptParseResponseSchema } from "./ai";
import { attributionResponse, receiptResponse } from "./test-fixtures";

const parseReceipt = (v: unknown) => ReceiptParseResponseSchema.safeParse(v);
const parseAttribution = (v: unknown) => AttributionResponseSchema.safeParse(v);

describe("ReceiptParseResponseSchema", () => {
  it("accepts a valid response", () => {
    expect(parseReceipt(receiptResponse).success).toBe(true);
  });

  it("accepts a minimal response, defaulting unreadableLines", () => {
    const result = parseReceipt({ items: [] });
    expect(result.success).toBe(true);
    expect(result.data?.unreadableLines).toEqual([]);
  });

  it("accepts a null lineTotal (unreadable price) and missing unitPrice/quantity", () => {
    const items = [{ name: "Dessert", rawText: "TIRAMISU ##.##", lineTotal: null, confidence: 0.3 }];
    expect(parseReceipt({ ...receiptResponse, items }).success).toBe(true);
  });

  it("rejects a price given as a string", () => {
    const item = receiptResponse.items[0];
    expect(parseReceipt({ ...receiptResponse, items: [{ ...item, lineTotal: "$12" }] }).success).toBe(false);
    expect(parseReceipt({ ...receiptResponse, items: [{ ...item, unitPrice: "$12" }] }).success).toBe(false);
    expect(parseReceipt({ ...receiptResponse, total: "$29.40" }).success).toBe(false);
  });

  it("rejects confidence above 1", () => {
    const items = [{ ...receiptResponse.items[0], confidence: 1.01 }];
    expect(parseReceipt({ ...receiptResponse, items }).success).toBe(false);
  });

  it("rejects items missing required fields", () => {
    const { lineTotal: _, ...noLineTotal } = receiptResponse.items[0];
    expect(parseReceipt({ ...receiptResponse, items: [noLineTotal] }).success).toBe(false);
    expect(parseReceipt({ merchant: "Luigi's" }).success).toBe(false);
  });

  it("rejects negative tax and non-positive quantity", () => {
    expect(parseReceipt({ ...receiptResponse, tax: -1 }).success).toBe(false);
    const items = [{ ...receiptResponse.items[0], quantity: 0 }];
    expect(parseReceipt({ ...receiptResponse, items }).success).toBe(false);
  });
});

describe("AttributionResponseSchema", () => {
  it("accepts a valid response", () => {
    expect(parseAttribution(attributionResponse).success).toBe(true);
  });

  it("accepts a minimal response, defaulting rules and flags", () => {
    const result = parseAttribution({ people: [{ name: "Sanil" }], assignments: [] });
    expect(result.success).toBe(true);
    expect(result.data?.rules).toEqual([]);
    expect(result.data?.flags).toEqual([]);
  });

  it("rejects a missing required field", () => {
    const { people: _, ...noPeople } = attributionResponse;
    expect(parseAttribution(noPeople).success).toBe(false);
  });

  it("rejects a negative weight", () => {
    const assignments = [{ itemId: "i1", shares: [{ person: "Sanil", weight: -1 }] }];
    expect(parseAttribution({ ...attributionResponse, assignments }).success).toBe(false);
  });

  it("rejects a fraction of 1.5", () => {
    const rules = [{ type: "covers_fraction", payer: "Sanil", beneficiary: "Jo", fraction: 1.5 }];
    expect(parseAttribution({ ...attributionResponse, rules }).success).toBe(false);
  });

  it("rejects an unknown rule type", () => {
    const rules = [{ type: "pays_everything", payer: "Sanil" }];
    expect(parseAttribution({ ...attributionResponse, rules }).success).toBe(false);
  });

  it("rejects a fixed amount given as a string", () => {
    const rules = [{ type: "pays_fixed", payer: "Jo", amount: "$10" }];
    expect(parseAttribution({ ...attributionResponse, rules }).success).toBe(false);
  });

  it("rejects references to people who are not listed", () => {
    const assignments = [{ itemId: "i1", shares: [{ person: "Mystery guest", weight: 1 }] }];
    const result = parseAttribution({ ...attributionResponse, assignments });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe('Unknown person "Mystery guest"');

    const rules = [{ type: "covers_fraction", payer: "Sanil", beneficiary: "Nobody", fraction: 1 }];
    expect(parseAttribution({ ...attributionResponse, rules }).success).toBe(false);
  });

  it("rejects duplicate people and duplicate shares", () => {
    const people = [{ name: "Sanil" }, { name: "Sanil" }];
    expect(parseAttribution({ ...attributionResponse, people, assignments: [], rules: [] }).success).toBe(false);

    const assignments = [{ itemId: "i1", shares: [{ person: "Alex", weight: 1 }, { person: "Alex", weight: 1 }] }];
    expect(parseAttribution({ ...attributionResponse, assignments }).success).toBe(false);
  });

  it("rejects an assignment with no shares", () => {
    const assignments = [{ itemId: "i1", shares: [] }];
    expect(parseAttribution({ ...attributionResponse, assignments }).success).toBe(false);
  });
});
