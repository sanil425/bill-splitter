import type { Item, Person, Rule, Split } from "@/lib/schemas";
import { formatCents } from "@/lib/money";

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

export const itemLabel = (item: Item) => (item.quantity && item.quantity > 1 ? `${item.quantity}× ${item.name}` : item.name);

export const splitTitle = (split: Split) => split.receipts.find((r) => r.merchant)?.merchant ?? "Untitled split";

/** What the receipts say the bill came to (display only; the calculator has the real numbers). */
export const printedTotalCents = (split: Split) => sum(split.receipts.map((r) => r.totalCents ?? 0));

export const shortDate = (iso: string, year = false) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year && { year: "numeric" }) });

const FRACTIONS: Record<number, string> = { 1: "all", 0.5: "half", 0.25: "a quarter", 0.75: "three quarters" };
export const fractionWord = (f: number) => FRACTIONS[f] ?? `${Math.round(f * 100)}%`;

export function describeRule(rule: Rule, people: readonly Person[]): string {
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "Someone";
  switch (rule.type) {
    case "covers_fraction":
      return `${name(rule.payer)} covers ${fractionWord(rule.fraction)} of ${name(rule.beneficiary)}'s total`;
    case "pays_charge":
      return `${name(rule.payer)} pays the ${rule.charge === "service" ? "service charge" : rule.charge}`;
    case "pays_fixed":
      return `${name(rule.payer)} pays ${formatCents(rule.amountCents)} in total`;
  }
}

/** "(1 of 2)" when someone had whole units of a multi-unit line, "(shared)" otherwise. */
export function shareSuffix(item: Item, shares: Record<string, number>, personId: string): string {
  const total = sum(Object.values(shares));
  const mine = shares[personId] ?? 0;
  if (mine >= total) return "";
  const units = item.quantity ? (item.quantity * mine) / total : NaN;
  return Number.isInteger(units) ? ` (${units} of ${item.quantity})` : " (shared)";
}
