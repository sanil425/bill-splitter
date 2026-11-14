import { calculate, CalculationError } from "../calculator";
import { formatCents } from "../money";
import type { Flag, FlagCode, FlagSeverity, Item, Receipt, Rule, Split } from "../schemas";

/** Printed amounts may differ from our sums by this many cents before we flag it. */
export const TOLERANCE_CENTS = 2;

/** Items the vision model is less sure of than this get a warning. */
export const LOW_CONFIDENCE_THRESHOLD = 0.8;

type ValidatorCode = Exclude<FlagCode, "MODEL_FLAG">;

/** Severity and confirmability of every validator flag. */
export const FLAG_KINDS: Record<ValidatorCode, { severity: FlagSeverity; confirmable: boolean }> = {
  ITEM_NO_PRICE: { severity: "blocking", confirmable: false },
  ITEM_UNASSIGNED: { severity: "blocking", confirmable: false },
  HOST_MISSING: { severity: "blocking", confirmable: false },
  RULE_UNKNOWN_PERSON: { severity: "blocking", confirmable: false },
  RULE_SELF: { severity: "blocking", confirmable: false },
  COVERAGE_OVER_100: { severity: "blocking", confirmable: false },
  CHARGE_NO_ITEMS: { severity: "blocking", confirmable: false },
  DUPLICATE_PERSON_ID: { severity: "blocking", confirmable: false },
  DUPLICATE_ITEM_ID: { severity: "blocking", confirmable: false },
  DUPLICATE_ASSIGNMENT: { severity: "blocking", confirmable: false },
  ASSIGNMENT_UNKNOWN_ITEM: { severity: "blocking", confirmable: false },
  SHARE_UNKNOWN_PERSON: { severity: "blocking", confirmable: false },
  INVALID_WEIGHT: { severity: "blocking", confirmable: false },
  INVALID_AMOUNT: { severity: "blocking", confirmable: false },
  CALCULATION_FAILED: { severity: "blocking", confirmable: false },
  SUBTOTAL_MISMATCH: { severity: "blocking", confirmable: true },
  UNREADABLE_LINE: { severity: "warning", confirmable: true },
  LOW_CONFIDENCE: { severity: "warning", confirmable: true },
  TOTAL_MISMATCH: { severity: "warning", confirmable: true },
  PERSON_NO_ITEMS: { severity: "warning", confirmable: true },
};

function makeFlag(
  code: ValidatorCode,
  idParts: readonly (string | number)[],
  message: string,
  refs: { itemId?: string; receiptId?: string } = {},
): Flag {
  return {
    id: [code, ...idParts].join(":"),
    code,
    ...FLAG_KINDS[code],
    source: "validator",
    message,
    ...(refs.itemId !== undefined && { itemId: refs.itemId }),
    ...(refs.receiptId !== undefined && { receiptId: refs.receiptId }),
    resolved: false,
  };
}

const isMustFix = (f: Flag) => f.severity === "blocking" && !f.confirmable;
const isCents = (n: number | undefined) => n === undefined || Number.isSafeInteger(n);
const quote = (s: string) => `“${s}”`;
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** "a, b and c" */
function list(xs: readonly string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** Human labels for people, items, receipts and rules, by id. */
function namer(split: Split) {
  const personName = new Map<string, string>();
  for (const p of split.people) if (!personName.has(p.id)) personName.set(p.id, p.name);
  const itemName = new Map<string, string>();
  split.receipts.forEach((r) => r.items.forEach((i) => itemName.has(i.id) || itemName.set(i.id, i.name)));

  const person = (id: string) => personName.get(id) ?? "someone not in this split";
  const receipt = (r: Receipt) => r.merchant ?? `Receipt ${split.receipts.indexOf(r) + 1}`;
  const receiptById = (id: string) => {
    const r = split.receipts.find((x) => x.id === id);
    return r ? receipt(r) : "A receipt";
  };
  const item = (id: string) => (itemName.has(id) ? quote(itemName.get(id)!) : "an item");

  const rule = (r: Rule): string => {
    switch (r.type) {
      case "covers_fraction":
        return `${person(r.payer)} covers ${Number((r.fraction * 100).toFixed(1))}% of ${person(r.beneficiary)}'s share`;
      case "pays_charge":
        return `${person(r.payer)} pays the ${r.charge === "service" ? "service charge" : r.charge}`;
      case "pays_fixed":
        return `${person(r.payer)} pays ${Number.isSafeInteger(r.amountCents) ? formatCents(r.amountCents) : "a fixed amount"}`;
    }
  };

  return { person, receipt, receiptById, item, rule: (r: Rule) => `the rule ${quote(rule(r))}` };
}

/**
 * Check a split and return every problem found, as flags. Pure: the same
 * split always gives the same flags, with the same ids.
 *
 * Every condition calculate() refuses has its own must-fix flag. When there
 * are none, calculate() is dry-run and any refusal becomes CALCULATION_FAILED,
 * so when no blocking flag is unresolved, calculate() will not throw.
 */
export function validate(split: Split): Flag[] {
  const flags: Flag[] = [];
  const add = (f: Flag) => flags.push(f);
  const name = namer(split);

  // --- People -------------------------------------------------------------

  const peopleById = groupBy(split.people, (p) => p.id);
  for (const [id, group] of peopleById) {
    if (group.length > 1) {
      add(makeFlag("DUPLICATE_PERSON_ID", [id], `${list(group.map((p) => p.name))} are saved as the same person. Remove one and add them again.`));
    }
  }
  if (!peopleById.has(split.hostId)) {
    add(makeFlag("HOST_MISSING", [split.hostId], "The host isn't in the list of people. Add them back or pick someone else as host."));
  }

  // --- Items and assignments -------------------------------------------------

  const allItems: Item[] = split.receipts.flatMap((r) => r.items);
  const itemsById = groupBy(allItems, (i) => i.id);
  for (const [id, group] of itemsById) {
    if (group.length > 1) {
      add(makeFlag("DUPLICATE_ITEM_ID", [id], `${list(group.map((i) => quote(i.name)))} are saved as the same item. Remove one and add it again.`, { itemId: id }));
    }
  }

  const assignmentsByItem = groupBy(split.assignments, (a) => a.itemId);
  for (const [itemId, group] of assignmentsByItem) {
    if (!itemsById.has(itemId)) {
      add(makeFlag("ASSIGNMENT_UNKNOWN_ITEM", [itemId], "Someone is assigned an item that isn't on any receipt. Remove that assignment."));
      continue;
    }
    if (group.length > 1) {
      add(makeFlag("DUPLICATE_ASSIGNMENT", [itemId], `${name.item(itemId)} is assigned twice. Merge the two assignments into one.`, { itemId }));
    }
    for (const a of group) {
      for (const [personId, weight] of Object.entries(a.shares)) {
        if (!peopleById.has(personId)) {
          add(makeFlag("SHARE_UNKNOWN_PERSON", [itemId, personId], `${name.item(itemId)} is shared with someone who isn't in this split. Remove them from it.`, { itemId }));
        }
        if (!Number.isFinite(weight) || weight <= 0) {
          add(makeFlag("INVALID_WEIGHT", [itemId, personId], `${name.person(personId)}'s share of ${name.item(itemId)} must be a positive number.`, { itemId }));
        }
      }
    }
  }

  for (const receipt of split.receipts) {
    for (const item of receipt.items) {
      const refs = { itemId: item.id, receiptId: receipt.id };
      const label = quote(item.name);
      if (item.lineTotalCents === null) {
        add(makeFlag("ITEM_NO_PRICE", [item.id], `Couldn't read the price of ${label}. Enter it to continue.`, refs));
      } else if (!Number.isSafeInteger(item.lineTotalCents)) {
        add(makeFlag("INVALID_AMOUNT", [item.id], `The price of ${label} isn't a whole number of cents.`, refs));
      }
      const assignment = assignmentsByItem.get(item.id)?.[0];
      if (!assignment || Object.keys(assignment.shares).length === 0) {
        add(makeFlag("ITEM_UNASSIGNED", [item.id], `Nobody is down for ${label}. Choose who had it.`, refs));
      }
      if (item.confidence < LOW_CONFIDENCE_THRESHOLD) {
        add(makeFlag("LOW_CONFIDENCE", [item.id], `${label} was hard to read. Check its name and price.`, refs));
      }
    }
  }

  // --- Receipts ----------------------------------------------------------------

  const tipOverride = split.charges.tipOverride;
  if (tipOverride?.kind === "amount" && !Number.isSafeInteger(tipOverride.value)) {
    add(makeFlag("INVALID_AMOUNT", ["tip_override"], "The tip amount isn't a whole number of cents."));
  }

  for (const receipt of split.receipts) {
    const label = name.receipt(receipt);
    const refs = { receiptId: receipt.id };
    const charges = { tax: receipt.taxCents, tip: receipt.tipCents, service: receipt.serviceChargeCents };

    for (const [kind, cents] of Object.entries(charges)) {
      if (!isCents(cents)) {
        add(makeFlag("INVALID_AMOUNT", [receipt.id, kind], `${label}: the ${kind} isn't a whole number of cents.`, refs));
      }
    }

    // The printed tip is ignored when the tip is overridden (as in calculate()).
    const chargedTip = tipOverride ? 0 : (charges.tip ?? 0);
    if (receipt.items.length === 0 && ((charges.tax ?? 0) !== 0 || chargedTip !== 0 || (charges.service ?? 0) !== 0)) {
      add(makeFlag("CHARGE_NO_ITEMS", [receipt.id], `${label} has tax, tip or service but no items to split it over. Add its items.`, refs));
    }

    // Only compare sums when every amount is known whole cents (bad ones are flagged above).
    const lineTotals = receipt.items.map((i) => i.lineTotalCents);
    const itemSum = lineTotals.every((c): c is number => c !== null && Number.isSafeInteger(c)) ? sum(lineTotals) : undefined;
    const printedOk = isCents(receipt.subtotalCents) && isCents(receipt.totalCents);

    if (printedOk && receipt.subtotalCents !== undefined && itemSum !== undefined && Math.abs(itemSum - receipt.subtotalCents) > TOLERANCE_CENTS) {
      add(
        makeFlag(
          "SUBTOTAL_MISMATCH",
          [receipt.id],
          `${label}: the items add up to ${formatCents(itemSum)} but the receipt's subtotal is ${formatCents(receipt.subtotalCents)}. Fix the prices, or confirm the receipt is wrong.`,
          refs,
        ),
      );
    }

    const subtotal = receipt.subtotalCents ?? itemSum;
    if (printedOk && receipt.totalCents !== undefined && subtotal !== undefined && Object.values(charges).every(isCents)) {
      const expected = subtotal + (charges.tax ?? 0) + (charges.tip ?? 0) + (charges.service ?? 0);
      if (Math.abs(expected - receipt.totalCents) > TOLERANCE_CENTS) {
        add(
          makeFlag(
            "TOTAL_MISMATCH",
            [receipt.id],
            `${label}: subtotal plus tax, tip and service is ${formatCents(expected)} but the printed total is ${formatCents(receipt.totalCents)}.`,
            refs,
          ),
        );
      }
    }

    receipt.unreadableLines.forEach((line, i) => {
      add(makeFlag("UNREADABLE_LINE", [receipt.id, i], `${label}: couldn't read ${quote(line)}. Add it as an item if it's something you paid for.`, refs));
    });
  }

  // --- Rules ---------------------------------------------------------------------

  const coverage = new Map<string, number>();
  split.rules.forEach((rule, r) => {
    const ruleId = `rule_${r}`;
    const involved = rule.type === "covers_fraction" ? [rule.payer, rule.beneficiary] : [rule.payer];
    for (const personId of new Set(involved)) {
      if (!peopleById.has(personId)) {
        add(makeFlag("RULE_UNKNOWN_PERSON", [ruleId, personId], `${capitalise(name.rule(rule))} refers to someone who isn't in this split. Change or remove it.`));
      }
    }
    if (rule.type === "pays_fixed" && !Number.isSafeInteger(rule.amountCents)) {
      add(makeFlag("INVALID_AMOUNT", [ruleId], `${capitalise(name.rule(rule))} needs a whole number of cents.`));
    }
    if (rule.type === "covers_fraction") {
      if (rule.payer === rule.beneficiary) {
        add(makeFlag("RULE_SELF", [ruleId], `${capitalise(name.rule(rule))} has ${name.person(rule.payer)} covering themselves. Pick someone else or remove it.`));
      } else {
        coverage.set(rule.beneficiary, (coverage.get(rule.beneficiary) ?? 0) + rule.fraction);
      }
    }
  });
  for (const [beneficiary, total] of coverage) {
    // Small epsilon so e.g. three 1/3 rules count as exactly 100%.
    if (total > 1 + 1e-9) {
      add(
        makeFlag(
          "COVERAGE_OVER_100",
          [beneficiary],
          `Rules cover ${Number((total * 100).toFixed(1))}% of ${name.person(beneficiary)}'s share. Together they can cover at most 100%.`,
        ),
      );
    }
  }

  // --- People with nothing -----------------------------------------------------

  const involved = new Set<string>([
    ...split.assignments.flatMap((a) => Object.keys(a.shares)),
    ...split.rules.flatMap((r) => (r.type === "covers_fraction" ? [r.payer, r.beneficiary] : [r.payer])),
  ]);
  for (const id of peopleById.keys()) {
    if (!involved.has(id)) {
      add(makeFlag("PERSON_NO_ITEMS", [id], `${name.person(id)} isn't down for any items. Assign them something or remove them.`));
    }
  }

  // --- Dry run ---------------------------------------------------------------------

  const unique = dedupe(flags);
  if (!unique.some(isMustFix)) {
    const failure = dryRun(split, name);
    if (failure) unique.push(failure);
  }
  return unique;
}

/**
 * Run calculate() and turn a refusal into a CALCULATION_FAILED flag. Only
 * CalculationErrors are caught; anything else is a bug and is rethrown.
 */
function dryRun(split: Split, name: ReturnType<typeof namer>): Flag | undefined {
  try {
    calculate(split);
    return undefined;
  } catch (e) {
    if (!(e instanceof CalculationError)) throw e;
    const { ruleIndex, personId, itemId, receiptId } = e.details;
    const rule = ruleIndex === undefined ? undefined : split.rules[ruleIndex];
    const idParts = [
      e.code,
      ...(ruleIndex !== undefined ? [`rule_${ruleIndex}`] : []),
      ...[personId, itemId, receiptId].filter((x): x is string => x !== undefined),
    ];
    return makeFlag("CALCULATION_FAILED", idParts, calculationMessage(e, split, rule, name), { itemId, receiptId });
  }
}

function calculationMessage(e: CalculationError, split: Split, rule: Rule | undefined, name: ReturnType<typeof namer>): string {
  const { personId, receiptId } = e.details;
  switch (e.code) {
    case "NEGATIVE_TOTAL":
      if (rule && personId) {
        return `${capitalise(name.rule(rule))} would leave ${name.person(personId)} owing less than nothing. Change or remove it.`;
      }
      break;
    case "NO_PARTICIPANTS":
      if (rule) return `${capitalise(name.rule(rule))} leaves an amount nobody else can pick up. Add more people or remove it.`;
      if (receiptId) return `${name.receiptById(receiptId)} has charges but nobody to split them between.`;
      if (split.charges.tipOverride?.kind === "amount") return "The tip can't be split because no receipt has any items.";
      break;
  }
  return "Couldn't work out the split. Check the item shares and rules; if this keeps happening, it's a bug.";
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function groupBy<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const group = out.get(k);
    if (group) group.push(x);
    else out.set(k, [x]);
  }
  return out;
}

/** Keep the first flag per id (e.g. two receipts sharing an id would repeat flags). */
function dedupe(flags: readonly Flag[]): Flag[] {
  const seen = new Set<string>();
  return flags.filter((f) => !seen.has(f.id) && (seen.add(f.id), true));
}
