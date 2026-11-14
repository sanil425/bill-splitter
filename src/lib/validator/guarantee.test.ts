import { describe, expect, it } from "vitest";
import { calculate } from "../calculator";
import { chance, int, mulberry32, pick, randomSplit, type Rand } from "../calculator/test-helpers";
import type { Assignment, Item, Split } from "../schemas";
import { canCalculate, isResolvable, mergeFlags, resolveFlag } from "./flags";
import { validate } from "./validate";

/** Ways to break a split. Several may be applied to one split. */
const breakers: Record<string, (s: Split, rand: Rand) => void> = {
  nullPrice: (s, rand) => withItem(s, rand, (it) => (it.lineTotalCents = null)),
  fractionalPrice: (s, rand) => withItem(s, rand, (it) => (it.lineTotalCents = 10.5)),
  fractionalTax: (s, rand) => (pick(rand, s.receipts).taxCents = 0.5),
  unassign: (s, rand) => withItem(s, rand, (it) => (s.assignments = s.assignments.filter((a) => a.itemId !== it.id))),
  emptyShares: (s, rand) => withAssignment(s, rand, (a) => (a.shares = {})),
  badWeight: (s, rand) =>
    withAssignment(s, rand, (a) => (a.shares[Object.keys(a.shares)[0] ?? s.people[0].id] = pick(rand, [0, -1, NaN, Infinity]))),
  shareUnknownPerson: (s, rand) => withAssignment(s, rand, (a) => (a.shares["ghost"] = 1)),
  assignmentUnknownItem: (s) => s.assignments.push({ itemId: "ghost", shares: { [s.people[0].id]: 1 } }),
  duplicateAssignment: (s, rand) => withAssignment(s, rand, (a) => s.assignments.push(structuredClone(a))),
  duplicatePersonId: (s, rand) => s.people.push({ ...pick(rand, s.people), name: "Twin" }),
  duplicateItemId: (s, rand) => withItem(s, rand, (it) => pick(rand, s.receipts).items.push({ ...it, name: "Copy" })),
  hostMissing: (s) => (s.hostId = "ghost"),
  ruleUnknownPerson: (s) => s.rules.push({ type: "pays_charge", payer: "ghost", charge: "tax" }),
  ruleSelf: (s, rand) => {
    const p = pick(rand, s.people).id;
    s.rules.push({ type: "covers_fraction", payer: p, beneficiary: p, fraction: 0.5 });
  },
  overCoverage: (s, rand) => {
    const b = pick(rand, s.people).id;
    const payer = s.people.find((p) => p.id !== b)?.id ?? "ghost";
    s.rules.push({ type: "covers_fraction", payer, beneficiary: b, fraction: 0.75 });
    s.rules.push({ type: "covers_fraction", payer, beneficiary: b, fraction: 0.5 });
  },
  fractionalFixed: (s, rand) => s.rules.push({ type: "pays_fixed", payer: pick(rand, s.people).id, amountCents: 1.5 }),
  chargeNoItems: (s) => s.receipts.push({ id: "empty", items: [], unreadableLines: [], taxCents: 100, serviceChargeCents: 50 }),
  tipNoItems: (s) => {
    s.receipts = s.receipts.map((r) => ({ ...r, items: [], taxCents: undefined, tipCents: undefined, serviceChargeCents: undefined }));
    s.assignments = [];
    s.charges.tipOverride = { kind: "amount", value: 500 };
  },
  // Confirmable / warnings
  subtotalOff: (s, rand) => {
    const r = pick(rand, s.receipts);
    r.subtotalCents = r.items.reduce((sum, i) => sum + (i.lineTotalCents ?? 0), 0) + int(rand, -50, 50);
  },
  totalOff: (s, rand) => (pick(rand, s.receipts).totalCents = int(rand, 0, 50000)),
  unreadable: (s, rand) => pick(rand, s.receipts).unreadableLines.push("##.##"),
  lowConfidence: (s, rand) => withItem(s, rand, (it) => (it.confidence = 0.5)),
  lonelyPerson: (s) => s.people.push({ id: "lonely", name: "Lonely", isHost: false }),
  bigFixed: (s, rand) => s.rules.push({ type: "pays_fixed", payer: pick(rand, s.people).id, amountCents: int(rand, 0, 100_000) }),
};

/** Run `fn` on a random item, if there is one (an earlier breaker may have removed them all). */
function withItem(s: Split, rand: Rand, fn: (item: Item) => void) {
  const items = s.receipts.flatMap((r) => r.items);
  if (items.length > 0) fn(pick(rand, items));
}

function withAssignment(s: Split, rand: Rand, fn: (a: Assignment) => void) {
  if (s.assignments.length > 0) fn(pick(rand, s.assignments));
}

describe("validator guarantee (600 random splits, many broken)", () => {
  it("whenever canCalculate(mergeFlags(...)) is true, calculate() does not throw", () => {
    const rand = mulberry32(4_2026_1114);
    const names = Object.keys(breakers);
    const codesSeen = new Set<string>();
    let calculable = 0;
    let blocked = 0;

    for (let run = 0; run < 600; run++) {
      const split = randomSplit(rand, chance(rand, 0.5));
      const applied: string[] = [];
      // A third of splits stay clean; the rest get 1–3 breakages.
      if (run % 3 !== 0) {
        for (let k = int(rand, 1, 3); k > 0; k--) {
          const name = pick(rand, names);
          breakers[name](split, rand);
          applied.push(name);
        }
      }
      const ctx = `run ${run} [${applied.join(", ")}]`;

      const fresh = validate(split);
      fresh.forEach((f) => codesSeen.add(f.code));
      expect(new Set(fresh.map((f) => f.id)).size, ctx).toBe(fresh.length);
      expect(validate(split), `${ctx} deterministic`).toEqual(fresh);

      // Every precondition has its own code: the dry run should only ever
      // catch refusals that depend on the numbers.
      for (const f of fresh.filter((f) => f.code === "CALCULATION_FAILED")) {
        expect(["NEGATIVE_TOTAL", "NO_PARTICIPANTS"], `${ctx} ${f.id}`).toContain(f.id.split(":")[1]);
      }

      // The host confirms some resolvable flags.
      let flags = mergeFlags(split.flags, fresh);
      for (const f of flags) if (isResolvable(f) && chance(rand, 0.7)) flags = resolveFlag(flags, f.id);

      if (canCalculate(flags)) {
        calculable++;
        expect(() => calculate(split), ctx).not.toThrow();
      } else {
        blocked++;
        expect(flags.some((f) => f.severity === "blocking" && !f.resolved), ctx).toBe(true);
      }
    }

    // Both outcomes are exercised, and most must-fix codes were produced.
    expect(calculable).toBeGreaterThan(100);
    expect(blocked).toBeGreaterThan(100);
    for (const code of [
      "ITEM_NO_PRICE",
      "ITEM_UNASSIGNED",
      "HOST_MISSING",
      "RULE_UNKNOWN_PERSON",
      "RULE_SELF",
      "COVERAGE_OVER_100",
      "CHARGE_NO_ITEMS",
      "DUPLICATE_PERSON_ID",
      "DUPLICATE_ITEM_ID",
      "DUPLICATE_ASSIGNMENT",
      "ASSIGNMENT_UNKNOWN_ITEM",
      "SHARE_UNKNOWN_PERSON",
      "INVALID_WEIGHT",
      "INVALID_AMOUNT",
      "CALCULATION_FAILED",
      "SUBTOTAL_MISMATCH",
    ]) {
      expect(codesSeen, code).toContain(code);
    }
  });
});
