import { describe, expect, it } from "vitest";
import { allocate } from "./allocate";
import { calculate } from "./calculate";
import { CalculationError } from "./errors";
import { chance, int, mulberry32, randomSplit } from "./test-helpers";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

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
