import osushi from "../../../evals/receipts/osushi.expected.json";
import type { Assignment, Person, Split } from "@/lib/schemas";
import { mergeFlags, validate } from "@/lib/validator";

export function newSplit(id: string, hostName: string, createdAt = new Date().toISOString()): Split {
  const hostId = `${id}_host`;
  return {
    id,
    createdAt,
    hostId,
    people: [{ id: hostId, name: hostName, isHost: true }],
    receipts: [],
    inputs: [],
    assignments: [],
    rules: [],
    charges: { tax: "proportional", tip: "proportional", service: "proportional" },
    flags: [],
  };
}

const RECEIPT_ID = "osushi";
const itemId = (n: number) => `osushi_${n}`;
// Display-only quantities the receipt photo shows (2× lines).
const QUANTITY: Record<number, number> = { 1: 2, 3: 2, 9: 2 };
const LOW_CONFIDENCE_ITEM = 7; // Eel Avocado Roll

/**
 * Dev sample (/?sample=1) and test fixture: the Osushi receipt with Ali,
 * Josh and Maya, one unassigned Coke and a model flag about it.
 */
export function sampleSplit(base: Split): Split {
  const host = base.people.find((p) => p.id === base.hostId) ?? { id: base.hostId, name: "Sanil", isHost: true };
  const [ali, josh, maya]: Person[] = ["Ali", "Josh", "Maya"].map((name) => ({
    id: `${base.id}_${name.toLowerCase()}`,
    name,
    isHost: false,
  }));
  const S = host.id, A = ali.id, J = josh.id, M = maya.id;

  // Item number -> shares. Item 1 (the first Coke) is deliberately unassigned.
  const who: Record<number, Assignment["shares"]> = {
    2: { [A]: 1 },
    3: { [S]: 1, [M]: 1 },
    4: { [M]: 1 },
    5: { [S]: 2, [A]: 1 },
    6: { [M]: 1 },
    7: { [A]: 1 },
    8: { [J]: 1 },
    9: { [S]: 1, [A]: 1 },
    10: { [M]: 1 },
    11: { [S]: 1 },
    12: { [A]: 1 },
    13: { [S]: 1 },
    14: { [A]: 1 },
    15: { [M]: 1 },
    16: { [S]: 1, [A]: 1, [M]: 1 },
  };

  const split: Split = {
    ...base,
    people: [host, ali, josh, maya],
    receipts: [
      {
        id: RECEIPT_ID,
        merchant: osushi.merchant,
        items: osushi.items.map((item, i) => ({
          id: itemId(i + 1),
          receiptId: RECEIPT_ID,
          name: item.name,
          rawText: item.name,
          lineTotalCents: item.lineTotalCents,
          ...(QUANTITY[i + 1] && { quantity: QUANTITY[i + 1] }),
          confidence: i + 1 === LOW_CONFIDENCE_ITEM ? 0.6 : 0.97,
        })),
        subtotalCents: osushi.subtotalCents,
        taxCents: osushi.taxCents,
        totalCents: osushi.totalCents,
        unreadableLines: [],
      },
    ],
    assignments: Object.entries(who).map(([n, shares]) => ({ itemId: itemId(Number(n)), shares })),
    rules: [{ type: "covers_fraction", payer: S, beneficiary: M, fraction: 0.5 }],
    charges: { tax: "proportional", tip: "proportional", service: "proportional" },
    flags: [
      {
        id: "attribution_0",
        code: "MODEL_FLAG",
        severity: "blocking",
        confirmable: true,
        source: "attribution",
        message: "Which Coke is Josh's? There are two Coke lines.",
        itemId: itemId(1),
        receiptId: RECEIPT_ID,
        resolved: false,
      },
    ],
  };
  return { ...split, flags: mergeFlags(split.flags, validate(split)) };
}

/** The sample after the host has sorted out the Coke: used by the static share page. */
export function finishedSampleSplit(): Split {
  const split = sampleSplit(newSplit("sample", "Sanil", "2026-09-25T19:30:00.000Z"));
  const josh = split.people[2].id;
  return {
    ...split,
    assignments: [{ itemId: itemId(1), shares: { [josh]: 1, [split.hostId]: 1 } }, ...split.assignments],
  };
}
