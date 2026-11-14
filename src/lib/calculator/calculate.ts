import { roundHalfAwayFromZero } from "../money";
import type { Assignment, Breakdown, ChargeKind, PersonBreakdown, Receipt, Split } from "../schemas";
import { allocate } from "./allocate";
import { CalculationError, type CalculationErrorDetails } from "./errors";

const CHARGE_KINDS: readonly ChargeKind[] = ["tax", "tip", "service"];

const zeros = (n: number) => new Array<number>(n).fill(0);
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Allocate by `weights` (negatives count as 0). If no weight is positive,
 * fall back to an equal split among `fallback`. Throws if there is nobody
 * to put a non-zero amount on.
 */
function allocateWithFallback(
  totalCents: number,
  weights: readonly number[],
  fallback: readonly boolean[],
  details: CalculationErrorDetails,
): number[] {
  if (totalCents === 0) return zeros(weights.length);
  const clamped = weights.map((w) => Math.max(0, w));
  if (sum(clamped) > 0) return allocate(totalCents, clamped);
  if (fallback.some(Boolean)) return allocate(totalCents, fallback.map((f) => (f ? 1 : 0)));
  throw new CalculationError("NO_PARTICIPANTS", `Nobody to split ${totalCents} cents between`, details);
}

/** Per-receipt working state after items are allocated. */
type ReceiptState = {
  receipt: Receipt;
  /** Sum of this receipt's line totals. */
  itemSubtotal: number;
  /** Each person's share of this receipt's items, by person index. */
  personSubtotal: number[];
  /** Whether each person has at least one item on this receipt. */
  participants: boolean[];
};

/**
 * Work out what everyone owes. Pure: same split in, same breakdown out.
 *
 * Steps, each using largest-remainder allocation so no cent is lost:
 * 1. Split each item's lineTotalCents by its share weights.
 * 2. Per receipt, split tax, tip and service among that receipt's people
 *    (proportional to item subtotal, or equal), honouring any tip override.
 * 3. Apply custom rules in order, recording their effect as adjustments.
 *
 * People appear in split.people order, which also breaks rounding ties.
 * Throws CalculationError rather than return a number it can't stand behind.
 */
export function calculate(split: Split): Breakdown {
  const { people } = split;
  const n = people.length;

  // --- Preconditions -------------------------------------------------------

  const indexById = new Map<string, number>();
  people.forEach((p, i) => {
    if (indexById.has(p.id)) {
      throw new CalculationError("DUPLICATE_ID", `Two people have id "${p.id}"`, { personId: p.id });
    }
    indexById.set(p.id, i);
  });
  const personIndex = (personId: string, details: CalculationErrorDetails): number => {
    const i = indexById.get(personId);
    if (i === undefined) {
      throw new CalculationError("UNKNOWN_PERSON", `Unknown person "${personId}"`, { ...details, personId });
    }
    return i;
  };

  const itemIds = new Set<string>();
  for (const receipt of split.receipts) {
    for (const item of receipt.items) {
      if (itemIds.has(item.id)) {
        throw new CalculationError("DUPLICATE_ID", `Two items have id "${item.id}"`, { itemId: item.id });
      }
      itemIds.add(item.id);
    }
  }

  const assignmentByItem = new Map<string, Assignment>();
  for (const a of split.assignments) {
    if (!itemIds.has(a.itemId)) {
      throw new CalculationError("UNKNOWN_ITEM", `Assignment for unknown item "${a.itemId}"`, { itemId: a.itemId });
    }
    if (assignmentByItem.has(a.itemId)) {
      throw new CalculationError("DUPLICATE_ASSIGNMENT", `Item "${a.itemId}" is assigned twice`, { itemId: a.itemId });
    }
    assignmentByItem.set(a.itemId, a);
  }

  split.rules.forEach((rule, ruleIndex) => {
    personIndex(rule.payer, { ruleIndex });
    if (rule.type === "covers_fraction") personIndex(rule.beneficiary, { ruleIndex });
  });

  // --- 1. Items --------------------------------------------------------------

  const itemLines: PersonBreakdown["items"][] = people.map(() => []);
  const itemsTotal = zeros(n);

  const receiptStates: ReceiptState[] = split.receipts.map((receipt) => {
    const state: ReceiptState = { receipt, itemSubtotal: 0, personSubtotal: zeros(n), participants: zeros(n).map(() => false) };

    for (const item of receipt.items) {
      const details = { itemId: item.id, receiptId: receipt.id };
      if (item.lineTotalCents === null) {
        throw new CalculationError("UNREADABLE_PRICE", `"${item.name}" has no readable price`, details);
      }
      const assignment = assignmentByItem.get(item.id);
      if (!assignment || Object.keys(assignment.shares).length === 0) {
        throw new CalculationError("UNASSIGNED_ITEM", `Nobody is assigned "${item.name}"`, details);
      }

      const weights = zeros(n);
      for (const [personId, weight] of Object.entries(assignment.shares)) {
        if (!Number.isFinite(weight) || weight <= 0) {
          throw new CalculationError("INVALID_WEIGHT", `Invalid weight ${weight} on "${item.name}"`, { ...details, personId });
        }
        weights[personIndex(personId, details)] = weight;
      }

      const amounts = allocate(item.lineTotalCents, weights);
      weights.forEach((w, i) => {
        if (w === 0) return;
        itemLines[i].push({ itemId: item.id, amountCents: amounts[i] });
        itemsTotal[i] += amounts[i];
        state.personSubtotal[i] += amounts[i];
        state.participants[i] = true;
      });
      state.itemSubtotal += item.lineTotalCents;
    }
    return state;
  });

  // --- 2. Charges, per receipt -------------------------------------------------

  const tipByReceipt = tipsPerReceipt(split, receiptStates);
  const chargeTotals: Record<ChargeKind, number[]> = { tax: zeros(n), tip: zeros(n), service: zeros(n) };
  let chargesAllocated = 0;

  receiptStates.forEach((state, r) => {
    const amounts: Record<ChargeKind, number> = {
      tax: state.receipt.taxCents ?? 0,
      tip: tipByReceipt[r],
      service: state.receipt.serviceChargeCents ?? 0,
    };
    for (const kind of CHARGE_KINDS) {
      const amount = amounts[kind];
      if (amount === 0) continue;
      const weights =
        split.charges[kind] === "equal" ? state.participants.map((p) => (p ? 1 : 0)) : state.personSubtotal;
      const shares = allocateWithFallback(amount, weights, state.participants, { receiptId: state.receipt.id });
      shares.forEach((c, i) => (chargeTotals[kind][i] += c));
      chargesAllocated += amount;
    }
  });

  // --- 3. Rules, in order ------------------------------------------------------

  const adjustments = zeros(n);
  const totalOf = (i: number) =>
    itemsTotal[i] + chargeTotals.tax[i] + chargeTotals.tip[i] + chargeTotals.service[i] + adjustments[i];

  split.rules.forEach((rule, ruleIndex) => {
    const before = people.map((_, i) => totalOf(i));
    const delta = zeros(n);
    const payer = personIndex(rule.payer, { ruleIndex });

    switch (rule.type) {
      case "covers_fraction": {
        // Covering part of a zero or negative balance moves nothing.
        const b = personIndex(rule.beneficiary, { ruleIndex });
        const moved = Math.max(0, roundHalfAwayFromZero(rule.fraction * before[b]));
        delta[b] -= moved;
        delta[payer] += moved;
        break;
      }
      case "pays_charge": {
        chargeTotals[rule.charge].forEach((share, i) => {
          if (i === payer) return;
          delta[i] -= share;
          delta[payer] += share;
        });
        break;
      }
      case "pays_fixed": {
        // Positive diff: payer pays less than their share, others make it up.
        const diff = before[payer] - rule.amountCents;
        if (diff === 0) break;
        const others = people.map((_, i) => i !== payer);
        const weights = before.map((t, i) => (others[i] ? t : 0));
        const spread = allocateWithFallback(diff, weights, others, { ruleIndex, personId: rule.payer });
        delta[payer] -= diff;
        spread.forEach((c, i) => (delta[i] += c));
        break;
      }
    }

    delta.forEach((d, i) => {
      adjustments[i] += d;
      const after = totalOf(i);
      if (after < 0 && after < before[i]) {
        throw new CalculationError(
          "NEGATIVE_TOTAL",
          `Rule ${ruleIndex + 1} (${rule.type}) would make ${people[i].name}'s total negative`,
          { ruleIndex, personId: people[i].id },
        );
      }
    });
  });

  // --- Result ------------------------------------------------------------------

  const perPerson: PersonBreakdown[] = people.map((p, i) => ({
    personId: p.id,
    items: itemLines[i],
    taxCents: chargeTotals.tax[i],
    tipCents: chargeTotals.tip[i],
    serviceCents: chargeTotals.service[i],
    adjustmentsCents: adjustments[i],
    totalCents: totalOf(i),
  }));

  const grandTotalCents = sum(receiptStates.map((s) => s.itemSubtotal)) + chargesAllocated;
  if (sum(perPerson.map((p) => p.totalCents)) !== grandTotalCents) {
    throw new CalculationError("INVARIANT", "Per-person totals don't add up to the grand total");
  }

  return { splitId: split.id, perPerson, grandTotalCents };
}

/**
 * The tip to split on each receipt. Without an override this is the printed
 * tip. A percent override is that % of each receipt's item subtotal; an
 * amount override is spread across receipts by item subtotal.
 */
function tipsPerReceipt(split: Split, states: readonly ReceiptState[]): number[] {
  const override = split.charges.tipOverride;
  if (!override) return states.map((s) => s.receipt.tipCents ?? 0);

  if (override.kind === "percent") {
    return states.map((s) => Math.max(0, roundHalfAwayFromZero((s.itemSubtotal * override.value) / 100)));
  }
  return allocateWithFallback(
    override.value,
    states.map((s) => s.itemSubtotal),
    states.map((s) => s.receipt.items.length > 0),
    {},
  );
}
