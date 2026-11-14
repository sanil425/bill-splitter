import { describe, expect, it } from "vitest";
import { assign, item, makeSplit, person, receipt } from "../calculator/test-helpers";
import type { Flag, Split } from "../schemas";
import { canCalculate, mergeFlags, resolveFlag } from "./flags";
import { validate } from "./validate";

const flag = (over: Partial<Flag> & Pick<Flag, "id">): Flag => ({
  code: "SUBTOTAL_MISMATCH",
  severity: "blocking",
  confirmable: true,
  source: "validator",
  message: "Something",
  resolved: false,
  ...over,
});

const mustFix = flag({ id: "ITEM_NO_PRICE:i1", code: "ITEM_NO_PRICE", confirmable: false });
const confirmable = flag({ id: "SUBTOTAL_MISMATCH:r1" });
const warning = flag({ id: "LOW_CONFIDENCE:i1", code: "LOW_CONFIDENCE", severity: "warning" });
const fromModel = flag({ id: "abc", code: "MODEL_FLAG", source: "attribution", message: "Not sure who had the beer" });

/** Subtotal printed as $20.00 but items add up to $15.00. */
function mismatched(): Split {
  return makeSplit({
    people: [person("a", true), person("b")],
    receipts: [receipt("r1", [item("i1", 1000), item("i2", 500)], { subtotalCents: 2000 })],
    assignments: [assign("i1", { a: 1 }), assign("i2", { b: 1 })],
  });
}

describe("canCalculate", () => {
  it("is true with no flags, or only warnings", () => {
    expect(canCalculate([])).toBe(true);
    expect(canCalculate([warning])).toBe(true);
  });

  it("is false while any blocking flag is unresolved", () => {
    expect(canCalculate([confirmable])).toBe(false);
    expect(canCalculate([mustFix])).toBe(false);
    expect(canCalculate([fromModel])).toBe(false);
  });

  it("is true once confirmable blocking flags are resolved", () => {
    expect(canCalculate([{ ...confirmable, resolved: true }, { ...fromModel, resolved: true }, warning])).toBe(true);
  });

  it("treats a must-fix flag as blocking even if marked resolved", () => {
    expect(canCalculate([{ ...mustFix, resolved: true }])).toBe(false);
  });
});

describe("resolveFlag", () => {
  it("resolves confirmable flags and warnings without mutating the input", () => {
    const flags = [confirmable, warning, fromModel];
    const after = resolveFlag(resolveFlag(resolveFlag(flags, confirmable.id), warning.id), fromModel.id);
    expect(after.every((f) => f.resolved)).toBe(true);
    expect(flags.every((f) => !f.resolved)).toBe(true);
  });

  it("refuses must-fix flags", () => {
    expect(() => resolveFlag([mustFix], mustFix.id)).toThrow(/must be fixed/);
  });

  it("refuses must-fix flags from the validator, e.g. CALCULATION_FAILED", () => {
    const s = mismatched();
    s.rules.push({ type: "pays_fixed", payer: "b", amountCents: 10_000 });
    const failed = validate(s).find((f) => f.code === "CALCULATION_FAILED")!;
    expect(() => resolveFlag([failed], failed.id)).toThrow();
  });

  it("throws for an unknown id", () => {
    expect(() => resolveFlag([warning], "nope")).toThrow(/no flag/);
  });
});

describe("mergeFlags", () => {
  it("keeps receipt-parser and attribution flags", () => {
    const receiptFlag = { ...fromModel, id: "r", source: "receipt" as const };
    expect(mergeFlags([fromModel, receiptFlag], [])).toEqual([fromModel, receiptFlag]);
  });

  it("drops validator flags that no longer apply", () => {
    expect(mergeFlags([confirmable, warning, fromModel], [warning])).toEqual([fromModel, warning]);
  });

  it("keeps resolved state for ids that still exist", () => {
    const merged = mergeFlags([{ ...confirmable, resolved: true }, { ...warning, resolved: true }], [confirmable, warning]);
    expect(merged.map((f) => f.resolved)).toEqual([true, true]);
  });

  it("takes the fresh message and fields", () => {
    const merged = mergeFlags([{ ...confirmable, resolved: true }], [{ ...confirmable, message: "New numbers" }]);
    expect(merged).toEqual([{ ...confirmable, message: "New numbers", resolved: true }]);
  });

  it("never carries resolved state onto a must-fix flag", () => {
    expect(mergeFlags([{ ...mustFix, resolved: true }], [mustFix])).toEqual([mustFix]);
  });

  it("round trip: a confirmed mismatch stays confirmed after an edit", () => {
    const split = mismatched();
    let flags = mergeFlags(split.flags, validate(split));
    expect(canCalculate(flags)).toBe(false);

    flags = resolveFlag(flags, "SUBTOTAL_MISMATCH:r1");
    expect(canCalculate(flags)).toBe(true);

    // The host renames an item and changes a price; the receipt still doesn't add up.
    split.receipts[0].items[0] = { ...split.receipts[0].items[0], name: "Pizza", lineTotalCents: 1200 };
    split.flags = flags;
    flags = mergeFlags(split.flags, validate(split));
    expect(flags.find((f) => f.id === "SUBTOTAL_MISMATCH:r1")).toMatchObject({ resolved: true });
    expect(canCalculate(flags)).toBe(true);

    // Fixing the receipt makes the flag go away.
    split.receipts[0].subtotalCents = 1700;
    flags = mergeFlags(flags, validate(split));
    expect(flags).toEqual([]);
  });

  it("round trip: a new must-fix problem blocks again", () => {
    const split = mismatched();
    let flags = resolveFlag(mergeFlags([], validate(split)), "SUBTOTAL_MISMATCH:r1");
    split.receipts[0].items[1].lineTotalCents = null;
    flags = mergeFlags(flags, validate(split));
    expect(flags.map((f) => f.id)).toEqual(["ITEM_NO_PRICE:i2"]);
    expect(canCalculate(flags)).toBe(false);
  });
});
