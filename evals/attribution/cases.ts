/**
 * Attribution eval: one hardcoded receipt and typed notes with the answers we
 * expect. Run against the real API with `npm run eval:attribution`.
 */
import type { AiRule, Item } from "../../src/lib/schemas";

const line = (id: string, name: string, cents: number): Item => ({
  id,
  receiptId: "r1",
  name,
  rawText: `${name.toUpperCase()} ${(cents / 100).toFixed(2)}`,
  lineTotalCents: cents,
  confidence: 0.97,
});

/** Includes two different pastas, for the ambiguity case. */
export const SAMPLE_RECEIPT_ITEMS: Item[] = [
  line("i1", "Margherita Pizza", 1800),
  line("i2", "Spaghetti Carbonara", 1900),
  line("i3", "Penne Arrabbiata", 1700),
  line("i4", "Cheeseburger", 1600),
  line("i5", "Loaded Nachos", 1400),
  line("i6", "Fries", 600),
  line("i7", "Caesar Salad", 1200),
  line("i8", "House IPA", 800),
];

export type ExpectedAttribution = {
  /** Everyone in the split, host included. Compared case-insensitively. */
  people: string[];
  /** itemId -> name -> weight. Weights are compared as ratios (2:1 equals 4:2). */
  assignments: Record<string, Record<string, number>>;
  /** Items that must be left unassigned. Every item is in exactly one of these two. */
  unassigned: string[];
  /** Exact set of rules, any order. Omitted means none. */
  rules?: AiRule[];
  /** "noBlocking": no blocking flags (warnings are fine). Or: a blocking flag mentioning one of these words. */
  flags: "noBlocking" | { blockingMentioning: string[] };
};

export type EvalCase = {
  name: string;
  hostName: string;
  messages: string[];
  expected: ExpectedAttribution;
};

export const CASES: EvalCase[] = [
  {
    name: "1. Everyone had their own item",
    hostName: "Maya",
    messages: [
      "I had the pizza. Josh got the cheeseburger and the IPA, Ali had the carbonara and the penne, Sam had the caesar.",
      "Sam also had the nachos and Josh had the fries",
    ],
    expected: {
      people: ["Maya", "Josh", "Ali", "Sam"],
      assignments: {
        i1: { Maya: 1 },
        i2: { Ali: 1 },
        i3: { Ali: 1 },
        i4: { Josh: 1 },
        i5: { Sam: 1 },
        i6: { Josh: 1 },
        i7: { Sam: 1 },
        i8: { Josh: 1 },
      },
      unassigned: [],
      flags: "noBlocking",
    },
  },
  {
    name: "2. Shared nachos and 'I had most of the fries'",
    hostName: "Maya",
    messages: [
      "I had the pizza, Josh had the burger and Ali had the salad. The three of us shared the nachos. I had most of the fries, Josh had the rest",
    ],
    expected: {
      people: ["Maya", "Josh", "Ali"],
      assignments: {
        i1: { Maya: 1 },
        i4: { Josh: 1 },
        i5: { Maya: 1, Josh: 1, Ali: 1 },
        i6: { Maya: 2, Josh: 1 },
        i7: { Ali: 1 },
      },
      unassigned: ["i2", "i3", "i8"],
      flags: "noBlocking",
    },
  },
  {
    name: "3. Correction: 'the burger was mine, wait no, Josh's'",
    hostName: "Maya",
    messages: ["I had the pizza and Ali had the salad", "the burger was mine, wait no, Josh's"],
    expected: {
      people: ["Maya", "Josh", "Ali"],
      assignments: { i1: { Maya: 1 }, i4: { Josh: 1 }, i7: { Ali: 1 } },
      unassigned: ["i2", "i3", "i5", "i6", "i8"],
      flags: "noBlocking",
    },
  },
  {
    name: "4. 'I'll cover half of Ali's' and 'Sam's paying the tip'",
    hostName: "Maya",
    messages: ["I had the pizza, Ali had the carbonara, Sam had the cheeseburger", "I'll cover half of Ali's. Sam's paying the tip"],
    expected: {
      people: ["Maya", "Ali", "Sam"],
      assignments: { i1: { Maya: 1 }, i2: { Ali: 1 }, i4: { Sam: 1 } },
      unassigned: ["i3", "i5", "i6", "i7", "i8"],
      rules: [
        { type: "covers_fraction", payer: "Maya", beneficiary: "Ali", fraction: 0.5 },
        { type: "pays_charge", payer: "Sam", charge: "tip" },
      ],
      flags: "noBlocking",
    },
  },
  {
    name: "5. Ambiguous 'I had the pasta' must be flagged",
    hostName: "Maya",
    messages: ["I had the pasta and Josh had the burger"],
    expected: {
      people: ["Maya", "Josh"],
      assignments: { i4: { Josh: 1 } },
      unassigned: ["i1", "i2", "i3", "i5", "i6", "i7", "i8"],
      flags: { blockingMentioning: ["pasta", "carbonara", "penne", "spaghetti"] },
    },
  },
];
