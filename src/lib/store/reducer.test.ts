import { describe, expect, it } from "vitest";
import { calculate } from "@/lib/calculator";
import { canCalculate } from "@/lib/validator";
import { splitReducer as reduce } from "./reducer";
import { finishedSampleSplit, newSplit, sampleSplit } from "./splits";

const sample = () => sampleSplit(newSplit("s1", "Sanil", "2026-09-25T19:30:00.000Z"));
const ids = (s = sample()) => ({ host: s.hostId, ali: s.people[1].id, josh: s.people[2].id, maya: s.people[3].id });
const sharesOf = (s: ReturnType<typeof sample>, itemId: string) => s.assignments.find((a) => a.itemId === itemId)?.shares;

describe("sample split", () => {
  it("starts blocked by the unassigned Coke and the model flag", () => {
    const s = sample();
    expect(s.people.map((p) => p.name)).toEqual(["Sanil", "Ali", "Josh", "Maya"]);
    expect(s.flags.map((f) => f.code).sort()).toEqual(["ITEM_UNASSIGNED", "LOW_CONFIDENCE", "MODEL_FLAG"]);
    expect(canCalculate(s.flags)).toBe(false);
  });

  it("finished sample adds up to the receipt total", () => {
    expect(calculate(finishedSampleSplit()).grandTotalCents).toBe(18736);
  });
});

describe("splitReducer", () => {
  it("assigning the Coke resolves the model flag about it and unblocks calculating", () => {
    let s = sample();
    s = reduce(s, { type: "toggleShare", itemId: "osushi_1", personId: ids(s).josh });
    expect(s.flags.some((f) => f.code === "ITEM_UNASSIGNED")).toBe(false);
    expect(s.flags.find((f) => f.id === "attribution_0")?.resolved).toBe(true);
    expect(canCalculate(s.flags)).toBe(true);
    expect(calculate(s).grandTotalCents).toBe(18736);
  });

  it("doesn't auto-resolve a model flag on an item that was already assigned", () => {
    let s = sample();
    s = { ...s, flags: s.flags.map((f) => (f.id === "attribution_0" ? { ...f, itemId: "osushi_2" } : f)) };
    s = reduce(s, { type: "toggleShare", itemId: "osushi_2", personId: ids(s).josh });
    expect(s.flags.find((f) => f.id === "attribution_0")?.resolved).toBe(false);
  });

  it("replacing the split never auto-resolves model flags", () => {
    const s = sample();
    const assigned = { ...s, assignments: [...s.assignments, { itemId: "osushi_1", shares: { [s.hostId]: 1 } }] };
    expect(reduce(s, { type: "replace", split: assigned }).flags.find((f) => f.id === "attribution_0")?.resolved).toBe(false);
  });

  it("editing a missing price fixes ITEM_NO_PRICE and marks the price checked", () => {
    let s = sample();
    s = reduce(s, { type: "addItem", receiptId: "osushi", id: "new1" });
    expect(s.receipts[0].items.at(-1)).toMatchObject({ id: "new1", name: "New item", lineTotalCents: null });
    expect(s.flags.some((f) => f.id === "ITEM_NO_PRICE:new1")).toBe(true);
    s = reduce(s, { type: "editItem", itemId: "new1", name: " Edamame ", lineTotalCents: 450 });
    expect(s.receipts[0].items.at(-1)).toMatchObject({ name: "Edamame", lineTotalCents: 450, confidence: 1 });
    expect(s.flags.some((f) => f.id === "ITEM_NO_PRICE:new1")).toBe(false);
    s = reduce(s, { type: "editItem", itemId: "osushi_7", lineTotalCents: 850 });
    expect(s.flags.some((f) => f.id === "LOW_CONFIDENCE:osushi_7")).toBe(false);
    expect(reduce(s, { type: "editItem", itemId: "new1", name: "  " })).toBe(s);
  });

  it("deleting an item drops its assignment and the model flag about it", () => {
    let s = reduce(sample(), { type: "removeItem", itemId: "osushi_1" });
    expect(s.receipts[0].items.some((i) => i.id === "osushi_1")).toBe(false);
    expect(s.flags.some((f) => f.itemId === "osushi_1")).toBe(false);
    s = reduce(s, { type: "removeItem", itemId: "osushi_2" });
    expect(sharesOf(s, "osushi_2")).toBeUndefined();
  });

  it("deleting a parsed photo deletes its receipt", () => {
    let s = sample();
    s = { ...s, inputs: [{ id: "ph1", kind: "photo", receiptId: "osushi" }] };
    s = reduce(s, { type: "removeInput", id: "ph1" });
    expect(s.receipts).toEqual([]);
    expect(s.assignments).toEqual([]);
    expect(s.flags.filter((f) => f.itemId)).toEqual([]);
  });

  it("edits a note but never blanks it", () => {
    let s = reduce(sample(), { type: "addInput", input: { id: "v1", kind: "voice", transcript: "" } });
    s = reduce(s, { type: "editInput", id: "v1", text: " Ali had the eel " });
    expect(s.inputs[0]).toEqual({ id: "v1", kind: "voice", transcript: "Ali had the eel" });
    expect(reduce(s, { type: "editInput", id: "v1", text: "" })).toBe(s);
  });

  it("toggling the last person off removes the assignment and re-flags it", () => {
    let s = sample();
    s = reduce(s, { type: "toggleShare", itemId: "osushi_2", personId: ids(s).ali });
    expect(sharesOf(s, "osushi_2")).toBeUndefined();
    expect(s.flags.some((f) => f.id === "ITEM_UNASSIGNED:osushi_2")).toBe(true);
  });

  it("sets weights and ignores invalid ones", () => {
    const s = sample();
    const { host } = ids(s);
    const heavier = reduce(s, { type: "setWeight", itemId: "osushi_3", personId: host, weight: 3 });
    expect(sharesOf(heavier, "osushi_3")?.[host]).toBe(3);
    expect(reduce(s, { type: "setWeight", itemId: "osushi_3", personId: host, weight: 0 })).toBe(s);
  });

  it("adds and renames people, rejecting blank names", () => {
    let s = sample();
    s = reduce(s, { type: "addPerson", id: "p_zoe", name: "  Zoe " });
    expect(s.people.at(-1)).toEqual({ id: "p_zoe", name: "Zoe", isHost: false });
    expect(s.flags.some((f) => f.code === "PERSON_NO_ITEMS")).toBe(true);
    s = reduce(s, { type: "renamePerson", personId: "p_zoe", name: "Zoë" });
    expect(s.people.at(-1)?.name).toBe("Zoë");
    expect(reduce(s, { type: "renamePerson", personId: "p_zoe", name: " " })).toBe(s);
  });

  it("removing a person drops their shares and rules; the host can't be removed", () => {
    let s = sample();
    const { host, maya } = ids(s);
    s = reduce(s, { type: "removePerson", personId: maya });
    expect(s.people).toHaveLength(3);
    expect(s.rules).toEqual([]);
    expect(sharesOf(s, "osushi_3")).toEqual({ [host]: 1 });
    expect(sharesOf(s, "osushi_6")).toBeUndefined();
    expect(reduce(s, { type: "removePerson", personId: host })).toBe(s);
  });

  it("sets charge methods and the tip override", () => {
    let s = sample();
    s = reduce(s, { type: "setChargeMethod", charge: "tax", method: "equal" });
    expect(s.charges.tax).toBe("equal");
    s = reduce(s, { type: "setTipOverride", tipOverride: { kind: "percent", value: 20 } });
    expect(s.charges.tipOverride).toEqual({ kind: "percent", value: 20 });
    s = reduce(s, { type: "setTipOverride", tipOverride: undefined });
    expect("tipOverride" in s.charges).toBe(false);
  });

  it("deletes a rule by index", () => {
    expect(reduce(sample(), { type: "deleteRule", index: 0 }).rules).toEqual([]);
  });

  it("refuses to resolve a must-fix flag", () => {
    expect(() => reduce(sample(), { type: "resolveFlag", flagId: "ITEM_UNASSIGNED:osushi_1" })).toThrow();
  });

  it("keeps a confirmed validator warning resolved across edits", () => {
    let s = reduce(sample(), { type: "resolveFlag", flagId: "LOW_CONFIDENCE:osushi_7" });
    s = reduce(s, { type: "setChargeMethod", charge: "tax", method: "equal" });
    expect(s.flags.find((f) => f.id === "LOW_CONFIDENCE:osushi_7")?.resolved).toBe(true);
  });

  it("adds and removes inputs", () => {
    let s = reduce(sample(), { type: "addInput", input: { id: "t1", kind: "text", text: "Josh had the pad thai" } });
    expect(s.inputs).toHaveLength(1);
    s = reduce(s, { type: "removeInput", id: "t1" });
    expect(s.inputs).toEqual([]);
  });
});
