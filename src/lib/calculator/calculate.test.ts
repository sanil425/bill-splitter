import { describe, expect, it } from "vitest";
import { BreakdownSchema, type Rule } from "../schemas";
import { calculate } from "./calculate";
import { CalculationError, type CalculationErrorCode } from "./errors";
import { assign, column, item, makeSplit, person, receipt } from "./test-helpers";

function expectError(fn: () => unknown, code: CalculationErrorCode) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CalculationError);
    expect((e as CalculationError).code).toBe(code);
    return e as CalculationError;
  }
  throw new Error(`Expected CalculationError ${code}, but nothing was thrown`);
}

describe("calculate: items", () => {
  it("gives a solo item to one person", () => {
    const b = calculate(makeSplit({ receipts: [receipt("r1", [item("i1", 1250)])], assignments: [assign("i1", { a: 1 })] }));
    expect(column(b, "totalCents")).toEqual({ a: 1250, b: 0, c: 0 });
    expect(b.perPerson[0].items).toEqual([{ itemId: "i1", amountCents: 1250 }]);
    expect(b.perPerson[1].items).toEqual([]);
    expect(b.grandTotalCents).toBe(1250);
  });

  it("splits a shared item equally", () => {
    const b = calculate(makeSplit({ receipts: [receipt("r1", [item("i1", 1000)])], assignments: [assign("i1", { a: 1, b: 1 })] }));
    expect(column(b, "totalCents")).toEqual({ a: 500, b: 500, c: 0 });
  });

  it("splits by weight 2:1", () => {
    const b = calculate(makeSplit({ receipts: [receipt("r1", [item("i1", 900)])], assignments: [assign("i1", { a: 2, b: 1 })] }));
    expect(column(b, "totalCents")).toEqual({ a: 600, b: 300, c: 0 });
  });

  it("splits $10 three ways with the extra penny going to the first person in split.people", () => {
    const parts = { receipts: [receipt("r1", [item("i1", 1000)])], assignments: [assign("i1", { c: 1, b: 1, a: 1 })] };
    expect(column(calculate(makeSplit(parts)), "totalCents")).toEqual({ a: 334, b: 333, c: 333 });

    const reordered = makeSplit({ ...parts, people: [person("c", true), person("b"), person("a")] });
    expect(column(calculate(reordered), "totalCents")).toEqual({ c: 334, b: 333, a: 333 });
  });

  it("splits discounts like any other item", () => {
    const b = calculate(
      makeSplit({
        receipts: [receipt("r1", [item("i1", 3000), item("i2", -600), item("i3", -1000)])],
        assignments: [assign("i1", { a: 1, b: 1, c: 1 }), assign("i2", { a: 1, b: 1 }), assign("i3", { a: 1, b: 1, c: 1 })],
      }),
    );
    expect(b.perPerson[0].items).toEqual([
      { itemId: "i1", amountCents: 1000 },
      { itemId: "i2", amountCents: -300 },
      { itemId: "i3", amountCents: -334 },
    ]);
    expect(column(b, "totalCents")).toEqual({ a: 366, b: 367, c: 667 });
    expect(b.grandTotalCents).toBe(1400);
  });
});

describe("calculate: charges", () => {
  const r1 = receipt("r1", [item("i1", 3000), item("i2", 1000)], { taxCents: 400, tipCents: 600, serviceChargeCents: 200 });
  const assignments = [assign("i1", { a: 1 }), assign("i2", { b: 1 })];

  it("sets the split method per charge (proportional tax and service, equal tip)", () => {
    const b = calculate(makeSplit({ receipts: [r1], assignments, charges: { tip: "equal" } }));
    expect(b).toEqual({
      splitId: "s1",
      perPerson: [
        { personId: "a", items: [{ itemId: "i1", amountCents: 3000 }], taxCents: 300, tipCents: 300, serviceCents: 150, adjustmentsCents: 0, totalCents: 3750 },
        { personId: "b", items: [{ itemId: "i2", amountCents: 1000 }], taxCents: 100, tipCents: 300, serviceCents: 50, adjustmentsCents: 0, totalCents: 1450 },
        { personId: "c", items: [], taxCents: 0, tipCents: 0, serviceCents: 0, adjustmentsCents: 0, totalCents: 0 },
      ],
      grandTotalCents: 5200,
    });
    expect(BreakdownSchema.safeParse(b).success).toBe(true);
  });

  it("splits equally only among people with items on the receipt", () => {
    const b = calculate(makeSplit({ receipts: [r1], assignments, charges: { tax: "equal" } }));
    expect(column(b, "taxCents")).toEqual({ a: 200, b: 200, c: 0 });
  });

  it("rounds proportional charges with largest remainder", () => {
    const b = calculate(makeSplit({ receipts: [{ ...r1, taxCents: 101 }], assignments }));
    expect(column(b, "taxCents")).toEqual({ a: 76, b: 25, c: 0 });
  });

  it("splits each receipt's charges using only that receipt's items", () => {
    const receipts = [
      receipt("r1", [item("i1", 2000)], { taxCents: 200, tipCents: 400 }),
      receipt("r2", [item("i2", 1500), item("i3", 500)], { taxCents: 150, tipCents: 300 }),
    ];
    const b = calculate(
      makeSplit({ receipts, assignments: [assign("i1", { a: 1, b: 1 }), assign("i2", { c: 1 }), assign("i3", { a: 1 })] }),
    );
    // r1: a/b 50:50. r2: a/c 500:1500; tax 150 -> 37.5 / 112.5, tie goes to a (earlier in people).
    expect(column(b, "taxCents")).toEqual({ a: 100 + 38, b: 100, c: 112 });
    expect(column(b, "tipCents")).toEqual({ a: 200 + 75, b: 200, c: 225 });
    expect(column(b, "totalCents")).toEqual({ a: 1913, b: 1300, c: 1837 });
    expect(b.grandTotalCents).toBe(5050);

    const equal = calculate(
      makeSplit({ receipts, assignments: [assign("i1", { a: 1, b: 1 }), assign("i2", { c: 1 }), assign("i3", { a: 1 })], charges: { tip: "equal" } }),
    );
    expect(column(equal, "tipCents")).toEqual({ a: 200 + 150, b: 200, c: 150 });
  });

  it("applies a percent tip override to each receipt's item subtotal, ignoring printed tips", () => {
    const b = calculate(
      makeSplit({
        receipts: [receipt("r1", [item("i1", 1000)], { tipCents: 999 }), receipt("r2", [item("i2", 2555)])],
        assignments: [assign("i1", { a: 1 }), assign("i2", { b: 1 })],
        charges: { tipOverride: { kind: "percent", value: 18 } },
      }),
    );
    expect(column(b, "tipCents")).toEqual({ a: 180, b: 460, c: 0 }); // 2555 * 18% = 459.9
    expect(b.grandTotalCents).toBe(1000 + 2555 + 180 + 460);
  });

  it("spreads an amount tip override across receipts by item subtotal, then within each receipt", () => {
    const b = calculate(
      makeSplit({
        receipts: [receipt("r1", [item("i1", 3000)], { tipCents: 50 }), receipt("r2", [item("i2", 1000)])],
        assignments: [assign("i1", { a: 1, b: 1 }), assign("i2", { c: 1 })],
        charges: { tipOverride: { kind: "amount", value: 1000 } },
      }),
    );
    expect(column(b, "tipCents")).toEqual({ a: 375, b: 375, c: 250 });
  });

  it("gives no proportional share to someone whose items net to a credit", () => {
    const b = calculate(
      makeSplit({
        receipts: [receipt("r1", [item("i1", 2000), item("i2", -500)], { taxCents: 150 })],
        assignments: [assign("i1", { a: 1 }), assign("i2", { b: 1 })],
      }),
    );
    expect(column(b, "taxCents")).toEqual({ a: 150, b: 0, c: 0 });
    expect(column(b, "totalCents")).toEqual({ a: 2150, b: -500, c: 0 });
  });

  it("falls back to an equal split when nobody has a positive item subtotal", () => {
    const b = calculate(
      makeSplit({ receipts: [receipt("r1", [item("i1", -500)], { taxCents: 100 })], assignments: [assign("i1", { a: 1, b: 1 })] }),
    );
    expect(column(b, "taxCents")).toEqual({ a: 50, b: 50, c: 0 });
  });

  it("ignores the printed receipt total", () => {
    const b = calculate(
      makeSplit({ receipts: [receipt("r1", [item("i1", 1000)], { taxCents: 80, totalCents: 99999 })], assignments: [assign("i1", { a: 1 })] }),
    );
    expect(b.grandTotalCents).toBe(1080);
  });
});

describe("calculate: rules", () => {
  // a 1000, b 2000, c 1000; no charges.
  const base = {
    receipts: [receipt("r1", [item("i1", 1000), item("i2", 2000), item("i3", 1000)])],
    assignments: [assign("i1", { a: 1 }), assign("i2", { b: 1 }), assign("i3", { c: 1 })],
  };
  const run = (rules: Rule[], parts = base) => calculate(makeSplit({ ...parts, rules }));

  it("covers_fraction moves part of the beneficiary's total to the payer", () => {
    const b = run([{ type: "covers_fraction", payer: "a", beneficiary: "b", fraction: 0.5 }]);
    expect(column(b, "totalCents")).toEqual({ a: 2000, b: 1000, c: 1000 });
    expect(column(b, "adjustmentsCents")).toEqual({ a: 1000, b: -1000, c: 0 });
  });

  it("covers_fraction rounds the moved amount and can cover everything", () => {
    expect(column(run([{ type: "covers_fraction", payer: "a", beneficiary: "c", fraction: 1 / 3 }]), "totalCents")).toEqual({
      a: 1333,
      b: 2000,
      c: 667,
    });
    expect(column(run([{ type: "covers_fraction", payer: "a", beneficiary: "b", fraction: 1 }]), "totalCents")).toEqual({
      a: 3000,
      b: 0,
      c: 1000,
    });
  });

  it("covers_fraction moves nothing when the beneficiary's total is a credit", () => {
    const parts = {
      receipts: [receipt("r1", [item("i1", 1000), item("i2", -300)])],
      assignments: [assign("i1", { a: 1 }), assign("i2", { b: 1 })],
    };
    const b = run([{ type: "covers_fraction", payer: "a", beneficiary: "b", fraction: 1 }], parts);
    expect(column(b, "totalCents")).toEqual({ a: 1000, b: -300, c: 0 });
  });

  it("pays_charge moves everyone else's share of that charge, across all receipts", () => {
    const parts = {
      receipts: [
        receipt("r1", [item("i1", 1000), item("i2", 2000), item("i3", 1000)], { tipCents: 400, taxCents: 80 }),
        receipt("r2", [item("i4", 1000)], { tipCents: 100 }),
      ],
      assignments: [...base.assignments, assign("i4", { b: 1 })],
    };
    const b = run([{ type: "pays_charge", payer: "a", charge: "tip" }], parts);
    expect(column(b, "tipCents")).toEqual({ a: 100, b: 300, c: 100 }); // shares still shown
    expect(column(b, "adjustmentsCents")).toEqual({ a: 400, b: -300, c: -100 });
    expect(column(b, "taxCents")).toEqual({ a: 20, b: 40, c: 20 }); // other charges untouched
    expect(column(b, "totalCents")).toEqual({ a: 1520, b: 3040, c: 1020 });
  });

  it("pays_fixed sets the payer's total and spreads the difference by everyone else's totals", () => {
    const b = run([{ type: "pays_fixed", payer: "a", amountCents: 0 }]);
    expect(column(b, "totalCents")).toEqual({ a: 0, b: 2667, c: 1333 });
    expect(column(b, "adjustmentsCents")).toEqual({ a: -1000, b: 667, c: 333 });
  });

  it("pays_fixed above the payer's share reduces everyone else", () => {
    const b = run([{ type: "pays_fixed", payer: "a", amountCents: 2500 }]);
    expect(column(b, "totalCents")).toEqual({ a: 2500, b: 1000, c: 500 });
  });

  it("pays_fixed spreads equally when everyone else's total is zero", () => {
    const parts = { receipts: [receipt("r1", [item("i1", 900)])], assignments: [assign("i1", { a: 1 })] };
    const b = run([{ type: "pays_fixed", payer: "a", amountCents: 0 }], parts);
    expect(column(b, "totalCents")).toEqual({ a: 0, b: 450, c: 450 });
  });

  it("pays_fixed throws when there is nobody else to cover the difference", () => {
    const parts = { people: [person("a", true)], receipts: [receipt("r1", [item("i1", 900)])], assignments: [assign("i1", { a: 1 })] };
    expectError(() => calculate(makeSplit({ ...parts, rules: [{ type: "pays_fixed", payer: "a", amountCents: 0 }] })), "NO_PARTICIPANTS");
    // Paying exactly your own total is fine.
    const b = calculate(makeSplit({ ...parts, rules: [{ type: "pays_fixed", payer: "a", amountCents: 900 }] }));
    expect(column(b, "totalCents")).toEqual({ a: 900 });
  });

  it("applies rules in array order", () => {
    const cover: Rule = { type: "covers_fraction", payer: "a", beneficiary: "c", fraction: 0.5 };
    const fixed: Rule = { type: "pays_fixed", payer: "a", amountCents: 0 };

    // Cover first: a 1500, b 2000, c 500; then a's 1500 is spread 2000:500.
    const coverFirst = run([cover, fixed]);
    expect(column(coverFirst, "totalCents")).toEqual({ a: 0, b: 3200, c: 800 });
    expect(column(coverFirst, "adjustmentsCents")).toEqual({ a: -1000, b: 1200, c: -200 });

    // Fixed first: a 0, b 2667, c 1333; then a covers half of c's 1333.
    const fixedFirst = run([fixed, cover]);
    expect(column(fixedFirst, "totalCents")).toEqual({ a: 667, b: 2667, c: 666 });
    expect(column(fixedFirst, "adjustmentsCents")).toEqual({ a: -333, b: 667, c: -334 });
  });

  it("throws when a rule would make a total negative", () => {
    const err = expectError(() => run([{ type: "pays_fixed", payer: "a", amountCents: 10000 }]), "NEGATIVE_TOTAL");
    expect(err.details).toEqual({ ruleIndex: 0, personId: "b" });
  });
});

describe("calculate: preconditions", () => {
  const ok = { receipts: [receipt("r1", [item("i1", 1000)])], assignments: [assign("i1", { a: 1 })] };

  it("rejects an item with an unreadable price", () => {
    const err = expectError(
      () => calculate(makeSplit({ receipts: [receipt("r1", [item("i1", null)])], assignments: [assign("i1", { a: 1 })] })),
      "UNREADABLE_PRICE",
    );
    expect(err.details).toEqual({ itemId: "i1", receiptId: "r1" });
  });

  it("rejects an item with no shares", () => {
    expectError(() => calculate(makeSplit({ ...ok, assignments: [] })), "UNASSIGNED_ITEM");
    expectError(() => calculate(makeSplit({ ...ok, assignments: [assign("i1", {})] })), "UNASSIGNED_ITEM");
  });

  it("rejects references to people who don't exist", () => {
    expectError(() => calculate(makeSplit({ ...ok, assignments: [assign("i1", { zed: 1 })] })), "UNKNOWN_PERSON");
    expectError(
      () => calculate(makeSplit({ ...ok, rules: [{ type: "pays_charge", payer: "zed", charge: "tax" }] })),
      "UNKNOWN_PERSON",
    );
    const err = expectError(
      () => calculate(makeSplit({ ...ok, rules: [{ type: "covers_fraction", payer: "a", beneficiary: "zed", fraction: 1 }] })),
      "UNKNOWN_PERSON",
    );
    expect(err.details).toEqual({ ruleIndex: 0, personId: "zed" });
  });

  it("rejects assignments to unknown items and duplicate assignments", () => {
    expectError(() => calculate(makeSplit({ ...ok, assignments: [...ok.assignments, assign("nope", { a: 1 })] })), "UNKNOWN_ITEM");
    expectError(() => calculate(makeSplit({ ...ok, assignments: [...ok.assignments, assign("i1", { b: 1 })] })), "DUPLICATE_ASSIGNMENT");
  });

  it("rejects duplicate person ids and invalid weights", () => {
    expectError(() => calculate(makeSplit({ ...ok, people: [person("a"), person("a")] })), "DUPLICATE_ID");
    expectError(() => calculate(makeSplit({ ...ok, assignments: [assign("i1", { a: -1 })] })), "INVALID_WEIGHT");
  });

  it("rejects a charge on a receipt with no items", () => {
    expectError(
      () => calculate(makeSplit({ ...ok, receipts: [...ok.receipts, receipt("r2", [], { taxCents: 50 })] })),
      "NO_PARTICIPANTS",
    );
  });
});

describe("calculate: purity", () => {
  it("returns the same result every time and does not modify its input", () => {
    const split = makeSplit({
      receipts: [receipt("r1", [item("i1", 1000), item("i2", 777)], { taxCents: 99, tipCents: 250 })],
      assignments: [assign("i1", { a: 1, b: 2 }), assign("i2", { b: 1, c: 1 })],
      rules: [{ type: "covers_fraction", payer: "a", beneficiary: "c", fraction: 0.5 }],
    });
    const snapshot = structuredClone(split);
    expect(calculate(split)).toEqual(calculate(split));
    expect(split).toEqual(snapshot);
  });
});
