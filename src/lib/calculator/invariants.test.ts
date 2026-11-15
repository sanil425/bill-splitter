import { describe, expect, it } from "vitest";
import { roundHalfAwayFromZero } from "../money";
import { allocate } from "./allocate";
import { calculate } from "./calculate";
import { CalculationError } from "./errors";
import { chance, int, mulberry32, pick, randomSplit } from "./test-helpers";

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

    // Make sure the test is mostly exercising successful calculations. (covers_fraction
    // uses pre-rule totals, so it can legitimately over-move after an earlier rule
    // already reduced the beneficiary; those runs refuse with NEGATIVE_TOTAL.)
    expect(calculated).toBeGreaterThan(425);
  });

  it("covers_fraction alone never over-moves, and coverage adding to 100% leaves the beneficiary at exactly 0", () => {
    const rand = mulberry32(7);
    const fractionSets = [[1], [0.5, 0.5], [1 / 3, 1 / 3, 1 / 3], [0.25, 0.75], [0.25, 0.25, 0.5], [0.5], [0.25, 1 / 3]];

    for (let run = 0; run < 300; run++) {
      const split = randomSplit(rand, false);
      if (split.people.length < 2) continue;
      const [beneficiary, ...payers] = split.people.map((p) => p.id);
      const fractions = pick(rand, fractionSets);
      split.rules = fractions.map((fraction) => ({ type: "covers_fraction", payer: pick(rand, payers), beneficiary, fraction }));

      const before = calculate({ ...split, rules: [] }).perPerson[0].totalCents;
      const b = calculate(split); // must not throw
      const covered = Math.min(1, sum(fractions));
      expect(b.perPerson[0].totalCents, `run ${run}`).toBe(before - roundHalfAwayFromZero(covered * before));
      if (covered === 1 || Math.abs(covered - 1) < 1e-9) expect(b.perPerson[0].totalCents, `run ${run}`).toBe(0);
      expect(sum(b.perPerson.map((p) => p.totalCents)), `run ${run}`).toBe(b.grandTotalCents);
    }
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
