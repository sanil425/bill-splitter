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

// --- Seeded random splits (shared by calculator and validator property tests) ---

/** Mulberry32: tiny seeded PRNG, so failures are reproducible. */
export function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rand = ReturnType<typeof mulberry32>;
export const int = (rand: Rand, min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
export const pick = <T>(rand: Rand, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
export const chance = (rand: Rand, p: number) => rand() < p;

/** A random valid split. Rules may still make calculate() refuse (NEGATIVE_TOTAL etc.). */
export function randomSplit(rand: Rand, withDiscounts: boolean): Split {
  const people: Person[] = Array.from({ length: int(rand, 1, 6) }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isHost: i === 0 }));
  const assignments: Assignment[] = [];

  const receipts: Receipt[] = Array.from({ length: int(rand, 1, 3) }, (_, r) => {
    const items: Item[] = Array.from({ length: int(rand, 1, 8) }, (_, k) => {
      const id = `r${r}i${k}`;
      const discount = withDiscounts && chance(rand, 0.15);
      const shares: Record<string, number> = {};
      for (const p of people) if (chance(rand, 0.5)) shares[p.id] = pick(rand, [1, 1, 1, 2, 3, 0.5]);
      if (Object.keys(shares).length === 0) shares[pick(rand, people).id] = 1;
      assignments.push({ itemId: id, shares });
      return {
        id,
        receiptId: `r${r}`,
        name: id,
        rawText: "",
        lineTotalCents: discount ? -int(rand, 1, 1500) : int(rand, 1, 5000),
        confidence: 1,
      };
    });
    const optional = (max: number) => (chance(rand, 0.7) ? int(rand, 0, max) : undefined);
    return { id: `r${r}`, items, unreadableLines: [], taxCents: optional(900), tipCents: optional(2000), serviceChargeCents: optional(500) };
  });

  const method = () => pick(rand, ["proportional", "equal"] as const);
  const charges: ChargeSettings = { tax: method(), tip: method(), service: method() };
  if (chance(rand, 0.2)) charges.tipOverride = { kind: "percent", value: pick(rand, [10, 15, 18, 20, 22.5]) };
  else if (chance(rand, 0.2)) charges.tipOverride = { kind: "amount", value: int(rand, 0, 5000) };

  const rules: Rule[] = Array.from({ length: int(rand, 0, 3) }, () => {
    const payer = pick(rand, people).id;
    switch (pick(rand, ["covers_fraction", "pays_charge", "pays_fixed"] as const)) {
      case "covers_fraction":
        return { type: "covers_fraction", payer, beneficiary: pick(rand, people).id, fraction: pick(rand, [0.25, 1 / 3, 0.5, 1]) };
      case "pays_charge":
        return { type: "pays_charge", payer, charge: pick(rand, ["tax", "tip", "service"] as const) };
      case "pays_fixed":
        return { type: "pays_fixed", payer, amountCents: int(rand, 0, 3000) };
    }
  });

  return makeSplit({ people, receipts, assignments, rules, charges });
}
