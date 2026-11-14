/** Builders for calculator tests. */
import type { Assignment, Breakdown, ChargeSettings, Item, Person, Receipt, Rule, Split } from "../schemas";

export const person = (id: string, isHost = false): Person => ({ id, name: id.toUpperCase(), isHost });

export const item = (id: string, lineTotalCents: number | null, receiptId = "r1"): Item => ({
  id,
  receiptId,
  name: id,
  rawText: "",
  lineTotalCents,
  confidence: 1,
});

export const receipt = (id: string, items: Item[], totals: Partial<Receipt> = {}): Receipt => ({
  id,
  items: items.map((i) => ({ ...i, receiptId: id })),
  unreadableLines: [],
  ...totals,
});

export const assign = (itemId: string, shares: Record<string, number>): Assignment => ({ itemId, shares });

export const PROPORTIONAL: ChargeSettings = { tax: "proportional", tip: "proportional", service: "proportional" };

export function makeSplit(parts: {
  people?: Person[];
  receipts: Receipt[];
  assignments: Assignment[];
  rules?: Rule[];
  charges?: Partial<ChargeSettings>;
}): Split {
  const people = parts.people ?? [person("a", true), person("b"), person("c")];
  return {
    id: "s1",
    createdAt: "2026-11-14T00:00:00.000Z",
    hostId: people[0].id,
    people,
    receipts: parts.receipts,
    inputs: [],
    assignments: parts.assignments,
    rules: parts.rules ?? [],
    charges: { ...PROPORTIONAL, ...parts.charges },
    flags: [],
  };
}

/** personId -> a numeric field from the breakdown, for compact assertions. */
export function column(
  breakdown: Breakdown,
  field: "totalCents" | "taxCents" | "tipCents" | "serviceCents" | "adjustmentsCents",
): Record<string, number> {
  return Object.fromEntries(breakdown.perPerson.map((p) => [p.personId, p[field]]));
}
