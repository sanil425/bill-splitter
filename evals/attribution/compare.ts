import type { AiRule, AttributionResponse } from "../../src/lib/schemas";
import type { ExpectedAttribution } from "./cases";

const key = (name: string) => name.trim().toLowerCase();

/** Weights scaled so they sum to 1, keyed by lower-cased name. */
function normalise(shares: Record<string, number>): Map<string, number> {
  const total = Object.values(shares).reduce((a, b) => a + b, 0);
  return new Map(Object.entries(shares).map(([name, w]) => [key(name), w / total]));
}

const showShares = (shares: Record<string, number>) =>
  Object.entries(shares)
    .map(([n, w]) => `${n}:${w}`)
    .join(", ");

function ruleKey(r: AiRule): string {
  switch (r.type) {
    case "covers_fraction":
      return `covers_fraction ${key(r.payer)} -> ${key(r.beneficiary)} ${r.fraction}`;
    case "pays_charge":
      return `pays_charge ${key(r.payer)} ${r.charge}`;
    case "pays_fixed":
      return `pays_fixed ${key(r.payer)} ${r.amount}`;
  }
}

/** Every way `actual` differs from `expected`, as readable lines. Empty means pass. */
export function compareAttribution(actual: AttributionResponse, expected: ExpectedAttribution, hostName: string): string[] {
  const diffs: string[] = [];

  // People
  const want = new Set(expected.people.map(key));
  const got = new Set(actual.people.map((p) => key(p.name)));
  const missing = [...want].filter((n) => !got.has(n));
  const extra = [...got].filter((n) => !want.has(n));
  if (missing.length) diffs.push(`people: missing ${missing.join(", ")}`);
  if (extra.length) diffs.push(`people: unexpected ${extra.join(", ")}`);
  const hosts = actual.people.filter((p) => p.isHost).map((p) => p.name);
  if (hosts.length !== 1 || key(hosts[0]) !== key(hostName)) diffs.push(`host: expected ${hostName}, got [${hosts.join(", ")}]`);

  // Assignments
  const actualByItem = new Map(
    actual.assignments.map((a) => [a.itemId, Object.fromEntries(a.shares.map((s) => [s.person, s.weight]))]),
  );
  for (const [itemId, shares] of Object.entries(expected.assignments)) {
    const got = actualByItem.get(itemId);
    if (!got) {
      diffs.push(`${itemId}: expected {${showShares(shares)}}, got unassigned`);
      continue;
    }
    const w = normalise(shares);
    const g = normalise(got);
    const same = w.size === g.size && [...w].every(([n, x]) => Math.abs((g.get(n) ?? -1) - x) < 1e-6);
    if (!same) diffs.push(`${itemId}: expected {${showShares(shares)}}, got {${showShares(got)}}`);
  }
  for (const itemId of expected.unassigned) {
    const got = actualByItem.get(itemId);
    if (got) diffs.push(`${itemId}: expected unassigned, got {${showShares(got)}}`);
  }
  const known = new Set([...Object.keys(expected.assignments), ...expected.unassigned]);
  for (const itemId of actualByItem.keys()) {
    if (!known.has(itemId)) diffs.push(`${itemId}: assigned but not in the case's item list`);
  }

  // Rules
  const wantRules = (expected.rules ?? []).map(ruleKey).sort();
  const gotRules = actual.rules.map(ruleKey).sort();
  for (const r of wantRules.filter((r) => !gotRules.includes(r))) diffs.push(`rules: missing ${r}`);
  for (const r of gotRules.filter((r) => !wantRules.includes(r))) diffs.push(`rules: unexpected ${r}`);

  // Flags
  const blocking = actual.flags.filter((f) => f.severity === "blocking");
  if (expected.flags === "noBlocking") {
    for (const f of blocking) diffs.push(`flags: unexpected blocking flag "${f.message}"`);
  } else {
    const words = expected.flags.blockingMentioning.map(key);
    if (!blocking.some((f) => words.some((w) => f.message.toLowerCase().includes(w)))) {
      diffs.push(`flags: expected a blocking flag mentioning one of [${words.join(", ")}], got ${blocking.length} blocking flag(s)`);
    }
  }

  return diffs;
}
