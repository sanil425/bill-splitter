import { z } from "zod";
import type { Receipt } from "../../src/lib/schemas";

/**
 * What a `<name>.expected.json` file holds: the parts of a domain Receipt that
 * must be right. A charge set to null must be absent; a missing key isn't checked.
 */
export const ExpectedReceiptSchema = z.object({
  merchant: z.string().nullish(),
  items: z.array(z.object({ name: z.string(), lineTotalCents: z.number().int().nullable() })),
  subtotalCents: z.number().int().nullish(),
  taxCents: z.number().int().nullish(),
  tipCents: z.number().int().nullish(),
  serviceChargeCents: z.number().int().nullish(),
  totalCents: z.number().int().nullish(),
});
export type ExpectedReceipt = z.infer<typeof ExpectedReceiptSchema>;

const CHARGES = ["subtotalCents", "taxCents", "tipCents", "serviceChargeCents", "totalCents"] as const;

/** A parsed receipt in the expected-file shape, ready to save. */
export function toExpected(r: Receipt): ExpectedReceipt {
  return {
    merchant: r.merchant ?? null,
    items: r.items.map((i) => ({ name: i.name, lineTotalCents: i.lineTotalCents })),
    ...Object.fromEntries(CHARGES.map((k) => [k, r[k] ?? null])),
  };
}

const money = (c: number | null | undefined) => (c == null ? "none" : (c / 100).toFixed(2));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Amounts must match exactly (item line totals as a multiset, plus each
 * charge). Item names vary in wording between runs, so they're only notes.
 */
export function compareReceipt(actual: Receipt, expected: ExpectedReceipt): { diffs: string[]; notes: string[] } {
  const diffs: string[] = [];
  const notes: string[] = [];

  if (actual.items.length !== expected.items.length) {
    diffs.push(`items: expected ${expected.items.length}, got ${actual.items.length}`);
  }

  const unmatched = [...actual.items];
  for (const want of expected.items) {
    const sameAmount = unmatched.filter((i) => i.lineTotalCents === want.lineTotalCents);
    if (sameAmount.length === 0) {
      diffs.push(`item "${want.name}" ${money(want.lineTotalCents)}: no item with that line total`);
      continue;
    }
    const match = sameAmount.find((i) => norm(i.name) === norm(want.name)) ?? sameAmount[0];
    if (norm(match.name) !== norm(want.name)) notes.push(`"${want.name}" was named "${match.name}"`);
    unmatched.splice(unmatched.indexOf(match), 1);
  }
  for (const extra of unmatched) diffs.push(`unexpected item "${extra.name}" ${money(extra.lineTotalCents)}`);

  for (const k of CHARGES) {
    if (!(k in expected)) continue;
    const want = expected[k] ?? undefined;
    if (actual[k] !== want) diffs.push(`${k}: expected ${money(want)}, got ${money(actual[k])}`);
  }

  if (expected.merchant && norm(actual.merchant ?? "") !== norm(expected.merchant)) {
    notes.push(`merchant "${expected.merchant}" was read as "${actual.merchant ?? "none"}"`);
  }
  return { diffs, notes };
}
