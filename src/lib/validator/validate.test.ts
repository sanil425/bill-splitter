import { describe, expect, it } from "vitest";
import { assign, item, makeSplit, person, receipt } from "../calculator/test-helpers";
import type { Flag, FlagCode, Split } from "../schemas";
import { FLAG_KINDS, validate } from "./validate";

/**
 * A split with no flags at all: Alex had the pizza, Bo had the beer,
 * subtotal and total match.
 */
function base(): Split {
  return makeSplit({
    people: [{ ...person("a", true), name: "Alex" }, { ...person("b"), name: "Bo" }],
    receipts: [
      receipt("r1", [{ ...item("i1", 1000), name: "Pizza" }, { ...item("i2", 500), name: "Beer" }], {
        merchant: "Luigi's",
        subtotalCents: 1500,
        taxCents: 150,
        totalCents: 1650,
      }),
    ],
    assignments: [assign("i1", { a: 1 }), assign("i2", { b: 1 })],
  });
}

function edit(mutate: (s: Split) => void): Split {
  const s = structuredClone(base());
  mutate(s);
  return s;
}

const byId = (flags: Flag[], id: string) => flags.find((f) => f.id === id);
const codes = (flags: Flag[]) => flags.map((f) => f.code);

/** Expect exactly one flag with this id; return it. */
function expectFlag(split: Split, id: string): Flag {
  const flags = validate(split);
  const matches = flags.filter((f) => f.id === id);
  expect(matches, `flags: ${flags.map((f) => f.id).join(", ")}`).toHaveLength(1);
  return matches[0];
}

function expectNoCode(split: Split, code: FlagCode) {
  expect(codes(validate(split))).not.toContain(code);
}

describe("validate: baseline", () => {
  it("returns no flags for a clean split", () => {
    expect(validate(base())).toEqual([]);
  });

  it("gives every flag the severity and confirmability from FLAG_KINDS", () => {
    const s = edit((s) => {
      s.receipts[0].items[0].lineTotalCents = null;
      s.receipts[0].unreadableLines = ["???"];
    });
    for (const f of validate(s)) {
      expect(f.source).toBe("validator");
      expect(f.resolved).toBe(false);
      expect({ severity: f.severity, confirmable: f.confirmable }).toEqual(FLAG_KINDS[f.code as keyof typeof FLAG_KINDS]);
    }
  });
});

describe("validate: blocking, must fix", () => {
  it("ITEM_NO_PRICE", () => {
    const f = expectFlag(edit((s) => (s.receipts[0].items[0].lineTotalCents = null)), "ITEM_NO_PRICE:i1");
    expect(f).toMatchObject({ severity: "blocking", confirmable: false, itemId: "i1", receiptId: "r1" });
    expect(f.message).toContain("Pizza");
    expect(f.message).not.toContain("i1");
    expectNoCode(base(), "ITEM_NO_PRICE");
  });

  it("ITEM_UNASSIGNED: no assignment, or one with no shares", () => {
    const f = expectFlag(edit((s) => s.assignments.pop()), "ITEM_UNASSIGNED:i2");
    expect(f.message).toContain("Beer");
    expectFlag(edit((s) => (s.assignments[1].shares = {})), "ITEM_UNASSIGNED:i2");
    expectNoCode(base(), "ITEM_UNASSIGNED");
  });

  it("HOST_MISSING", () => {
    expectFlag(edit((s) => (s.hostId = "zz")), "HOST_MISSING:zz");
    expectNoCode(base(), "HOST_MISSING");
  });

  it("RULE_UNKNOWN_PERSON: payer or beneficiary", () => {
    expectFlag(edit((s) => s.rules.push({ type: "pays_charge", payer: "zz", charge: "tax" })), "RULE_UNKNOWN_PERSON:rule_0:zz");
    const f = expectFlag(
      edit((s) => s.rules.push({ type: "covers_fraction", payer: "a", beneficiary: "zz", fraction: 0.5 })),
      "RULE_UNKNOWN_PERSON:rule_0:zz",
    );
    expect(f.message).toContain("Alex");
    expectNoCode(edit((s) => s.rules.push({ type: "pays_charge", payer: "a", charge: "tax" })), "RULE_UNKNOWN_PERSON");
  });

  it("RULE_SELF", () => {
    const f = expectFlag(edit((s) => s.rules.push({ type: "covers_fraction", payer: "a", beneficiary: "a", fraction: 0.5 })), "RULE_SELF:rule_0");
    expect(f.message).toContain("Alex");
    expectNoCode(edit((s) => s.rules.push({ type: "covers_fraction", payer: "a", beneficiary: "b", fraction: 0.5 })), "RULE_SELF");
  });

  it("COVERAGE_OVER_100", () => {
    const over = edit((s) => {
      s.people.push({ id: "c", name: "Cy", isHost: false });
      s.rules.push({ type: "covers_fraction", payer: "a", beneficiary: "b", fraction: 0.6 });
      s.rules.push({ type: "covers_fraction", payer: "c", beneficiary: "b", fraction: 0.5 });
    });
    const f = expectFlag(over, "COVERAGE_OVER_100:b");
    expect(f.message).toContain("110%");
    expect(f.message).toContain("Bo");

    const exactlyFull = edit((s) => {
      for (let k = 0; k < 3; k++) s.rules.push({ type: "covers_fraction", payer: "a", beneficiary: "b", fraction: 1 / 3 });
    });
    expectNoCode(exactlyFull, "COVERAGE_OVER_100");
  });

  it("CHARGE_NO_ITEMS (printed tip ignored when overridden)", () => {
    const f = expectFlag(edit((s) => s.receipts.push(receipt("r2", [], { merchant: "Bar", taxCents: 100 }))), "CHARGE_NO_ITEMS:r2");
    expect(f.message).toContain("Bar");
    expectNoCode(edit((s) => s.receipts.push(receipt("r2", []))), "CHARGE_NO_ITEMS");
    expectNoCode(
      edit((s) => {
        s.receipts.push(receipt("r2", [], { tipCents: 300 }));
        s.charges.tipOverride = { kind: "percent", value: 18 };
      }),
      "CHARGE_NO_ITEMS",
    );
  });

  it("DUPLICATE_PERSON_ID", () => {
    const f = expectFlag(edit((s) => s.people.push({ id: "b", name: "Bea", isHost: false })), "DUPLICATE_PERSON_ID:b");
    expect(f.message).toContain("Bo and Bea");
    expectNoCode(base(), "DUPLICATE_PERSON_ID");
  });

  it("DUPLICATE_ITEM_ID", () => {
    const s = edit((s) => s.receipts.push(receipt("r2", [{ ...item("i1", 300), name: "Chips" }])));
    expect(expectFlag(s, "DUPLICATE_ITEM_ID:i1").message).toContain("“Pizza” and “Chips”");
    expectNoCode(base(), "DUPLICATE_ITEM_ID");
  });

  it("DUPLICATE_ASSIGNMENT", () => {
    expectFlag(edit((s) => s.assignments.push(assign("i1", { b: 1 }))), "DUPLICATE_ASSIGNMENT:i1");
    expectNoCode(base(), "DUPLICATE_ASSIGNMENT");
  });

  it("ASSIGNMENT_UNKNOWN_ITEM", () => {
    expectFlag(edit((s) => s.assignments.push(assign("ghost", { a: 1 }))), "ASSIGNMENT_UNKNOWN_ITEM:ghost");
    expectNoCode(base(), "ASSIGNMENT_UNKNOWN_ITEM");
  });

  it("SHARE_UNKNOWN_PERSON", () => {
    expectFlag(edit((s) => (s.assignments[0].shares = { a: 1, zz: 1 })), "SHARE_UNKNOWN_PERSON:i1:zz");
    expectNoCode(base(), "SHARE_UNKNOWN_PERSON");
  });

  it("INVALID_WEIGHT: zero, negative, NaN, Infinity", () => {
    for (const w of [0, -1, NaN, Infinity]) {
      const f = expectFlag(edit((s) => (s.assignments[0].shares = { a: w })), "INVALID_WEIGHT:i1:a");
      expect(f.message).toContain("Alex");
    }
    expectNoCode(edit((s) => (s.assignments[0].shares = { a: 0.5, b: 2 })), "INVALID_WEIGHT");
  });

  it("INVALID_AMOUNT: item price, charge, fixed rule, tip override", () => {
    expectFlag(edit((s) => (s.receipts[0].items[0].lineTotalCents = 10.5)), "INVALID_AMOUNT:i1");
    expectFlag(edit((s) => (s.receipts[0].taxCents = 1.5)), "INVALID_AMOUNT:r1:tax");
    expectFlag(edit((s) => s.rules.push({ type: "pays_fixed", payer: "a", amountCents: 2.5 })), "INVALID_AMOUNT:rule_0");
    expectFlag(edit((s) => (s.charges.tipOverride = { kind: "amount", value: 1.5 })), "INVALID_AMOUNT:tip_override");
    expectNoCode(edit((s) => (s.charges.tipOverride = { kind: "amount", value: 150 })), "INVALID_AMOUNT");
  });
});

describe("validate: CALCULATION_FAILED (calculator dry run)", () => {
  it("turns NEGATIVE_TOTAL into a flag naming the rule and person", () => {
    // Bo paying $100 of a $16.50 bill pushes the excess onto Alex as a negative amount.
    const s = edit((s) => s.rules.push({ type: "pays_fixed", payer: "b", amountCents: 10_000 }));
    const f = expectFlag(s, "CALCULATION_FAILED:NEGATIVE_TOTAL:rule_0:a");
    expect(f).toMatchObject({ severity: "blocking", confirmable: false });
    expect(f.message).toBe("The rule “Bo pays $100.00” would leave Alex owing less than nothing. Change or remove it.");
  });

  it("turns NO_PARTICIPANTS into a flag naming the rule", () => {
    const s = edit((s) => {
      s.people = [s.people[0]];
      s.assignments = [assign("i1", { a: 1 }), assign("i2", { a: 1 })];
      s.rules.push({ type: "pays_fixed", payer: "a", amountCents: 0 });
    });
    const f = expectFlag(s, "CALCULATION_FAILED:NO_PARTICIPANTS:rule_0:a");
    expect(f.message).toContain("“Alex pays $0.00”");
  });

  it("explains a tip amount with no items to split it over", () => {
    const s = edit((s) => {
      s.receipts = [receipt("r1", [])];
      s.assignments = [];
      s.charges.tipOverride = { kind: "amount", value: 500 };
    });
    expect(expectFlag(s, "CALCULATION_FAILED:NO_PARTICIPANTS").message).toBe("The tip can't be split because no receipt has any items.");
  });

  it("does not dry-run while must-fix flags exist", () => {
    const s = edit((s) => {
      s.rules.push({ type: "pays_fixed", payer: "b", amountCents: 10_000 });
      s.receipts[0].items[0].lineTotalCents = null;
    });
    expectNoCode(s, "CALCULATION_FAILED");
  });

  it("still dry-runs when only confirmable flags exist", () => {
    const s = edit((s) => {
      s.rules.push({ type: "pays_fixed", payer: "b", amountCents: 10_000 });
      s.receipts[0].subtotalCents = 9999;
    });
    expect(codes(validate(s))).toEqual(expect.arrayContaining(["SUBTOTAL_MISMATCH", "CALCULATION_FAILED"]));
  });

  it("does not flag a split the calculator accepts", () => {
    expectNoCode(edit((s) => s.rules.push({ type: "pays_fixed", payer: "b", amountCents: 1000 })), "CALCULATION_FAILED");
  });
});

describe("validate: blocking, confirmable", () => {
  it("SUBTOTAL_MISMATCH: 2 cents off passes, 3 cents off flags (either direction)", () => {
    const at = (subtotalCents: number) => edit((s) => (s.receipts[0].subtotalCents = subtotalCents));
    expectNoCode(at(1502), "SUBTOTAL_MISMATCH");
    expectNoCode(at(1498), "SUBTOTAL_MISMATCH");
    const f = expectFlag(at(1503), "SUBTOTAL_MISMATCH:r1");
    expect(f).toMatchObject({ severity: "blocking", confirmable: true, receiptId: "r1" });
    expect(f.message).toContain("$15.00");
    expect(f.message).toContain("$15.03");
    expect(f.message).toContain("Luigi's");
    expectFlag(at(1497), "SUBTOTAL_MISMATCH:r1");
  });

  it("skips SUBTOTAL_MISMATCH when a price is unknown or no subtotal is printed", () => {
    expectNoCode(
      edit((s) => {
        s.receipts[0].items[0].lineTotalCents = null;
        s.receipts[0].subtotalCents = 1;
      }),
      "SUBTOTAL_MISMATCH",
    );
    expectNoCode(edit((s) => delete s.receipts[0].subtotalCents), "SUBTOTAL_MISMATCH");
  });
});

describe("validate: warnings", () => {
  it("UNREADABLE_LINE: one per line", () => {
    const flags = validate(edit((s) => (s.receipts[0].unreadableLines = ["TH4NK Y0U", "##.##"])));
    expect(byId(flags, "UNREADABLE_LINE:r1:0")?.message).toContain("TH4NK Y0U");
    expect(byId(flags, "UNREADABLE_LINE:r1:1")).toMatchObject({ severity: "warning", receiptId: "r1" });
    expectNoCode(base(), "UNREADABLE_LINE");
  });

  it("LOW_CONFIDENCE: below 0.8 only", () => {
    const f = expectFlag(edit((s) => (s.receipts[0].items[1].confidence = 0.79)), "LOW_CONFIDENCE:i2");
    expect(f).toMatchObject({ severity: "warning", itemId: "i2" });
    expect(f.message).toContain("Beer");
    expectNoCode(edit((s) => (s.receipts[0].items[1].confidence = 0.8)), "LOW_CONFIDENCE");
  });

  it("TOTAL_MISMATCH: 2 cents off passes, 3 cents off flags", () => {
    const at = (totalCents: number) => edit((s) => (s.receipts[0].totalCents = totalCents));
    expectNoCode(at(1652), "TOTAL_MISMATCH");
    expectNoCode(at(1648), "TOTAL_MISMATCH");
    expect(expectFlag(at(1653), "TOTAL_MISMATCH:r1")).toMatchObject({ severity: "warning" });
    expectFlag(at(1647), "TOTAL_MISMATCH:r1");
  });

  it("TOTAL_MISMATCH uses the line totals when no subtotal is printed", () => {
    expectNoCode(edit((s) => delete s.receipts[0].subtotalCents), "TOTAL_MISMATCH");
    expectFlag(
      edit((s) => {
        delete s.receipts[0].subtotalCents;
        s.receipts[0].items[0].lineTotalCents = 1100;
      }),
      "TOTAL_MISMATCH:r1",
    );
  });

  it("PERSON_NO_ITEMS: unless a rule involves them", () => {
    const withCy = (s: Split) => s.people.push({ id: "c", name: "Cy", isHost: false });
    const f = expectFlag(edit(withCy), "PERSON_NO_ITEMS:c");
    expect(f.message).toContain("Cy");
    expectNoCode(
      edit((s) => {
        withCy(s);
        s.rules.push({ type: "pays_charge", payer: "c", charge: "tax" });
      }),
      "PERSON_NO_ITEMS",
    );
    expectNoCode(
      edit((s) => {
        withCy(s);
        s.rules.push({ type: "covers_fraction", payer: "a", beneficiary: "c", fraction: 1 });
      }),
      "PERSON_NO_ITEMS",
    );
  });
});

describe("validate: ids", () => {
  it("are the same across re-runs and unrelated edits", () => {
    const broken = (s: Split) => {
      s.receipts[0].subtotalCents = 2000;
      s.receipts[0].unreadableLines = ["??"];
      s.receipts[0].items[1].confidence = 0.5;
    };
    const first = validate(edit(broken)).map((f) => f.id);
    expect(validate(edit(broken)).map((f) => f.id)).toEqual(first);

    const edited = edit((s) => {
      broken(s);
      s.receipts[0].items[0].name = "Margherita";
      s.receipts[0].items[0].lineTotalCents = 1100;
    });
    expect(validate(edited).map((f) => f.id)).toEqual(first);
  });

  it("are unique even when receipts share an id", () => {
    const s = edit((s) => s.receipts.push(receipt("r1", [], { unreadableLines: ["x"] })));
    s.receipts[0].unreadableLines = ["y"];
    const ids = validate(s).map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
