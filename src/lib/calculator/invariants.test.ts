import { describe, expect, it } from "vitest";
import type { Assignment, ChargeSettings, Item, Person, Receipt, Rule, Split } from "../schemas";
import { allocate } from "./allocate";
import { calculate } from "./calculate";
import { CalculationError } from "./errors";
import { makeSplit } from "./test-helpers";

/** Mulberry32: tiny seeded PRNG, so failures are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = ReturnType<typeof mulberry32>;
const int = (rand: Rand, min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T,>(rand: Rand, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const chance = (rand: Rand, p: number) => rand() < p;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function randomSplit(rand: Rand, withDiscounts: boolean): Split {
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

describe("calculator invariants (500 random splits)", () => {
  it("per-person totals add up exactly, and only discounts make a total negative", () => {
    const rand = mulberry32(20261114);
    let calculated = 0;

    for (let run = 0; run < 500; run++) {
      const withDiscounts = run % 2 === 1;
      const split = randomSplit(rand, withDiscounts);

      let b;
      try {
        b = calculate(split);
      } catch (e) {
        // Legitimate refusals from random rules: a rule that would push someone
        // negative (e.g. pays_fixed above everyone else's total), or pays_fixed
        // when there is nobody else to cover the difference. Nothing else is.
        expect(e, `run ${run}`).toBeInstanceOf(CalculationError);
        expect(["NEGATIVE_TOTAL", "NO_PARTICIPANTS"], `run ${run}`).toContain((e as CalculationError).code);
        if ((e as CalculationError).code === "NO_PARTICIPANTS") {
          expect(split.people.length, `run ${run}`).toBe(1);
        }
        continue;
      }
      calculated++;

      const lineTotals = sum(split.receipts.flatMap((r) => r.items.map((i) => i.lineTotalCents ?? 0)));
      const charges = sum(b.perPerson.map((p) => p.taxCents + p.tipCents + p.serviceCents));

      expect(sum(b.perPerson.map((p) => p.totalCents)), `run ${run}`).toBe(b.grandTotalCents);
      expect(b.grandTotalCents, `run ${run}`).toBe(lineTotals + charges);
      expect(sum(b.perPerson.flatMap((p) => p.items.map((i) => i.amountCents))), `run ${run}`).toBe(lineTotals);
      expect(sum(b.perPerson.map((p) => p.adjustmentsCents)), `run ${run}`).toBe(0);

      for (const p of b.perPerson) {
        const parts = sum(p.items.map((i) => i.amountCents)) + p.taxCents + p.tipCents + p.serviceCents + p.adjustmentsCents;
        expect(p.totalCents, `run ${run} ${p.personId}`).toBe(parts);
        for (const n of [p.totalCents, p.taxCents, p.tipCents, p.serviceCents, p.adjustmentsCents]) {
          expect(Number.isSafeInteger(n), `run ${run}`).toBe(true);
        }
        if (p.totalCents < 0) {
          // Only someone holding a discount can end up owed money.
          expect(withDiscounts, `run ${run} ${p.personId}`).toBe(true);
          expect(p.items.some((i) => i.amountCents < 0), `run ${run} ${p.personId}`).toBe(true);
        }
      }
    }

    // Make sure the test is mostly exercising successful calculations.
    expect(calculated).toBeGreaterThan(450);
  });

  it("allocate adds up exactly for random totals and weights", () => {
    const rand = mulberry32(42);
    for (let run = 0; run < 500; run++) {
      const total = int(rand, -100000, 100000);
      const weights = Array.from({ length: int(rand, 1, 8) }, () => (chance(rand, 0.2) ? 0 : rand() * 10));
      if (!weights.some((w) => w > 0)) weights[0] = 1;
      const result = allocate(total, weights);
      expect(sum(result), `run ${run}`).toBe(total);
      result.forEach((c, i) => {
        if (weights[i] === 0) expect(c).toBe(0);
        // Each share is within one cent of its exact proportional value.
        const exact = (total * weights[i]) / sum(weights);
        expect(Math.abs(c - exact), `run ${run}`).toBeLessThan(1 + 1e-6);
      });
    }
  });
});
