import type { ChargeKind, Input, Item, SplitMethod, Split, TipOverride } from "@/lib/schemas";
import { mergeFlags, resolveFlag, validate } from "@/lib/validator";

export type SplitAction =
  | { type: "replace"; split: Split }
  | { type: "toggleShare"; itemId: string; personId: string }
  | { type: "setWeight"; itemId: string; personId: string; weight: number }
  | { type: "addPerson"; id: string; name: string }
  | { type: "renamePerson"; personId: string; name: string }
  | { type: "removePerson"; personId: string }
  | { type: "setChargeMethod"; charge: ChargeKind; method: SplitMethod }
  | { type: "setTipOverride"; tipOverride: TipOverride | undefined }
  | { type: "deleteRule"; index: number }
  | { type: "resolveFlag"; flagId: string }
  | { type: "addInput"; input: Input }
  | { type: "editInput"; id: string; text: string }
  | { type: "removeInput"; id: string }
  | { type: "editItem"; itemId: string; name?: string; lineTotalCents?: number }
  | { type: "addItem"; receiptId: string; id: string }
  | { type: "removeItem"; itemId: string };

/** Applies one edit, then re-runs the validator so flags always match the split. */
export function splitReducer(split: Split, action: SplitAction): Split {
  const next = apply(split, action);
  if (next === split) return split;
  const flags = action.type === "replace" ? next.flags : resolveNewlyAssigned(split, next);
  return { ...next, flags: mergeFlags(flags, validate(next)) };
}

/** An AI flag about an item ("which Coke is Josh's?") is answered once the host assigns that item. */
function resolveNewlyAssigned(before: Split, after: Split) {
  const was = new Set(before.assignments.map((a) => a.itemId));
  const is = new Set(after.assignments.map((a) => a.itemId));
  return after.flags.map((f) =>
    f.source === "attribution" && f.itemId && is.has(f.itemId) && !was.has(f.itemId) ? { ...f, resolved: true } : f,
  );
}

const mapItems = (split: Split, fn: (items: Item[], receiptId: string) => Item[]): Split => ({
  ...split,
  receipts: split.receipts.map((r) => ({ ...r, items: fn(r.items, r.id) })),
});

/** Drops items, their assignments and AI flags about them (validator flags are recomputed anyway). */
function withoutItems(split: Split, gone: Set<string>): Split {
  return {
    ...mapItems(split, (items) => items.filter((i) => !gone.has(i.id))),
    assignments: split.assignments.filter((a) => !gone.has(a.itemId)),
    flags: split.flags.filter((f) => !(f.itemId && gone.has(f.itemId))),
  };
}

function apply(split: Split, action: SplitAction): Split {
  switch (action.type) {
    case "replace":
      return action.split;

    case "toggleShare": {
      const { itemId, personId } = action;
      const existing = split.assignments.find((a) => a.itemId === itemId);
      if (!existing) {
        return { ...split, assignments: [...split.assignments, { itemId, shares: { [personId]: 1 } }] };
      }
      const shares = { ...existing.shares };
      if (personId in shares) delete shares[personId];
      else shares[personId] = 1;
      const assignments = Object.keys(shares).length
        ? split.assignments.map((a) => (a === existing ? { itemId, shares } : a))
        : split.assignments.filter((a) => a !== existing);
      return { ...split, assignments };
    }

    case "setWeight": {
      const { itemId, personId, weight } = action;
      if (!Number.isFinite(weight) || weight <= 0) return split;
      return {
        ...split,
        assignments: split.assignments.map((a) =>
          a.itemId === itemId && personId in a.shares ? { itemId, shares: { ...a.shares, [personId]: weight } } : a,
        ),
      };
    }

    case "addPerson": {
      const name = action.name.trim();
      if (!name) return split;
      return { ...split, people: [...split.people, { id: action.id, name, isHost: false }] };
    }

    case "renamePerson": {
      const name = action.name.trim();
      if (!name) return split;
      return { ...split, people: split.people.map((p) => (p.id === action.personId ? { ...p, name } : p)) };
    }

    case "removePerson": {
      const id = action.personId;
      if (id === split.hostId) return split;
      const assignments = split.assignments.flatMap((a) => {
        if (!(id in a.shares)) return [a];
        const { [id]: _, ...shares } = a.shares;
        return Object.keys(shares).length ? [{ ...a, shares }] : [];
      });
      const rules = split.rules.filter(
        (r) => r.payer !== id && !(r.type === "covers_fraction" && r.beneficiary === id),
      );
      return { ...split, people: split.people.filter((p) => p.id !== id), assignments, rules };
    }

    case "setChargeMethod":
      return { ...split, charges: { ...split.charges, [action.charge]: action.method } };

    case "setTipOverride": {
      const { tipOverride: _, ...rest } = split.charges;
      return { ...split, charges: action.tipOverride ? { ...rest, tipOverride: action.tipOverride } : rest };
    }

    case "deleteRule":
      return { ...split, rules: split.rules.filter((_, i) => i !== action.index) };

    case "resolveFlag":
      return { ...split, flags: resolveFlag(split.flags, action.flagId) };

    case "addInput":
      return { ...split, inputs: [...split.inputs, action.input] };

    case "editInput": {
      const text = action.text.trim();
      if (!text) return split;
      return {
        ...split,
        inputs: split.inputs.map((i) =>
          i.id !== action.id ? i : i.kind === "text" ? { ...i, text } : i.kind === "voice" ? { ...i, transcript: text } : i,
        ),
      };
    }

    case "removeInput": {
      const input = split.inputs.find((i) => i.id === action.id);
      if (!input) return split;
      const rest = { ...split, inputs: split.inputs.filter((i) => i !== input) };
      if (input.kind !== "photo" || !input.receiptId) return rest;
      // Deleting a parsed photo deletes its receipt too.
      const receipt = split.receipts.find((r) => r.id === input.receiptId);
      const cleaned = withoutItems(rest, new Set(receipt?.items.map((i) => i.id)));
      return {
        ...cleaned,
        receipts: cleaned.receipts.filter((r) => r.id !== input.receiptId),
        flags: cleaned.flags.filter((f) => f.receiptId !== input.receiptId),
      };
    }

    case "editItem": {
      const name = action.name?.trim();
      const cents = action.lineTotalCents;
      if (action.name !== undefined && !name) return split;
      if (cents !== undefined && !Number.isSafeInteger(cents)) return split;
      return mapItems(split, (items) =>
        items.map((i) =>
          i.id !== action.itemId
            ? i
            : {
                ...i,
                ...(name && { name }),
                // The host typed the price, so it's no longer a guess.
                ...(cents !== undefined && { lineTotalCents: cents, confidence: 1 }),
              },
        ),
      );
    }

    case "addItem":
      return mapItems(split, (items, receiptId) =>
        receiptId !== action.receiptId
          ? items
          : [...items, { id: action.id, receiptId, name: "New item", rawText: "", lineTotalCents: null, confidence: 1 }],
      );

    case "removeItem":
      return withoutItems(split, new Set([action.itemId]));
  }
}
