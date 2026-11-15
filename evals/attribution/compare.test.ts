import { describe, expect, it } from "vitest";
import type { AttributionResponse } from "../../src/lib/schemas";
import { CASES, SAMPLE_RECEIPT_ITEMS, type EvalCase } from "./cases";
import { compareAttribution } from "./compare";

/** The answer a perfect model would give for a case. */
function perfectAnswer(c: EvalCase): AttributionResponse {
  const words = c.expected.flags === "noBlocking" ? [] : c.expected.flags.blockingMentioning;
  return {
    people: c.expected.people.map((name) => (name === c.hostName ? { name, isHost: true } : { name })),
    assignments: Object.entries(c.expected.assignments).map(([itemId, shares]) => ({
      itemId,
      shares: Object.entries(shares).map(([person, weight]) => ({ person, weight })),
    })),
    rules: c.expected.rules ?? [],
    flags: words.length ? [{ severity: "blocking", message: `Which ${words[0]} was yours?` }] : [],
  };
}

describe("attribution eval cases (offline)", () => {
  it("put every receipt item in exactly one of assignments / unassigned", () => {
    const ids = SAMPLE_RECEIPT_ITEMS.map((i) => i.id).sort();
    for (const c of CASES) {
      expect([...Object.keys(c.expected.assignments), ...c.expected.unassigned].sort(), c.name).toEqual(ids);
    }
  });

  it("pass a perfect answer", () => {
    for (const c of CASES) expect(compareAttribution(perfectAnswer(c), c.expected, c.hostName), c.name).toEqual([]);
  });

  it("report what differs", () => {
    const c = CASES[1];
    const answer = perfectAnswer(c);
    answer.assignments = answer.assignments.map((a) =>
      a.itemId === "i6" ? { ...a, shares: [{ person: "Maya", weight: 1 }, { person: "Josh", weight: 1 }] } : a,
    );
    answer.rules = [{ type: "pays_charge", payer: "Josh", charge: "tax" }];
    answer.people.push({ name: "Zed" });
    expect(compareAttribution(answer, c.expected, c.hostName)).toEqual([
      "people: unexpected zed",
      "i6: expected {Maya:2, Josh:1}, got {Maya:1, Josh:1}",
      "rules: unexpected pays_charge josh tax",
    ]);
    expect(compareAttribution(perfectAnswer(CASES[0]), CASES[4].expected, "Maya")).toContain(
      "flags: expected a blocking flag mentioning one of [pasta, carbonara, penne, spaghetti], got 0 blocking flag(s)",
    );
  });
});
