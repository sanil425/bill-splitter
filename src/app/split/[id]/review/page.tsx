"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FlagBanner } from "@/components/flag-banner";
import { ItemRow, itemRowId } from "@/components/item-row";
import { useSplit } from "@/components/split-store";
import { Avatar, BottomBar, Button, Card, IconButton, Pill, SectionLabel, TopBar, TrashIcon } from "@/components/ui";
import { describeRule } from "@/lib/display";
import { formatCents, toCents } from "@/lib/money";
import type { ChargeKind, Receipt, SplitMethod } from "@/lib/schemas";
import { canCalculate } from "@/lib/validator";

const COLLAPSED_ITEMS = 7;
const TIP_PERCENTS = [18, 20, 22];

export default function ReviewPage() {
  const { split, dispatch } = useSplit();
  const router = useRouter();
  const open = split.flags.filter((f) => !f.resolved);
  const blocking = open.filter((f) => f.severity === "blocking").length;
  const ready = canCalculate(split.flags);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const pick = (itemId: string) => {
    setOpenItem(itemId);
    // After React renders the opened row (and expands a collapsed list).
    requestAnimationFrame(() => document.getElementById(itemRowId(itemId))?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <>
      <TopBar title="Review" subtitle="Step 2 of 3 · Check" backHref={`/split/${split.id}/capture`} />
      <main className="flex flex-1 flex-col gap-5.5 px-5 pt-3 pb-5">
        <FlagBanner flags={open} onResolve={(flagId) => dispatch({ type: "resolveFlag", flagId })} onPick={pick} />
        <People />
        {split.receipts.map((r) => (
          <ReceiptCard key={r.id} receipt={r} openItem={openItem} onOpen={setOpenItem} onAdded={pick} />
        ))}
        {split.receipts.length === 0 && (
          <p className="text-center text-sm text-muted">No receipts yet. Go back to add a photo.</p>
        )}
        <Charges />
        {split.rules.length > 0 && (
          <Card className="flex flex-col gap-2.5 p-3.5">
            <SectionLabel>From your conversation</SectionLabel>
            {split.rules.map((rule, index) => (
              <div key={index} className="flex items-center justify-between gap-3">
                <span className="text-[15px]">{describeRule(rule, split.people)}</span>
                <IconButton
                  aria-label="Delete rule"
                  className="text-muted"
                  onClick={() => dispatch({ type: "deleteRule", index })}
                >
                  <TrashIcon />
                </IconButton>
              </div>
            ))}
          </Card>
        )}
      </main>
      <BottomBar className="flex flex-col gap-2">
        {!ready && (
          <p className="text-center text-[13px] text-muted">
            {blocking > 0 ? `Fix ${blocking} ${blocking === 1 ? "item" : "items"} to continue` : "Add a receipt to continue"}
          </p>
        )}
        <Button disabled={!ready || split.receipts.length === 0} onClick={() => router.push(`/split/${split.id}/breakdown`)}>
          Calculate
        </Button>
      </BottomBar>
    </>
  );
}

function People() {
  const { split, dispatch } = useSplit();
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState("");

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <SectionLabel>People</SectionLabel>
        <button
          type="button"
          onClick={() => setEditing(!editing)}
          className="-my-3 px-2 py-3 text-sm font-semibold text-primary hover:text-primary-hover"
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {!editing && (
        <div className="flex flex-wrap items-center gap-1.5">
          {split.people.map((p, i) => (
            <span
              key={p.id}
              className={`inline-flex h-9 items-center gap-2 rounded-full border pr-3.5 pl-1 text-sm font-medium ${
                p.isHost ? "border-primary bg-primary-tint text-primary-hover" : "border-stone-300 bg-white"
              }`}
            >
              <Avatar name={p.name} index={i} />
              {p.isHost ? `${p.name} (you)` : p.name}
            </span>
          ))}
          <Pill aria-label="Add person" onClick={() => setEditing(true)}>
            + Add
          </Pill>
        </div>
      )}

      {editing && (
        <Card className="flex flex-col divide-y divide-divider">
          {split.people.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2.5 px-3.5 py-2">
              <Avatar name={p.name} index={i} />
              <label htmlFor={`person-${p.id}`} className="sr-only">
                Name
              </label>
              <input
                id={`person-${p.id}`}
                defaultValue={p.name}
                onBlur={(e) => dispatch({ type: "renamePerson", personId: p.id, name: e.target.value })}
                className="h-11 min-w-0 flex-1 rounded-ib border border-transparent px-2 text-[15px] focus:border-stone-300"
              />
              {p.isHost ? (
                <span className="w-11 text-center text-xs text-muted">You</span>
              ) : (
                <IconButton
                  aria-label={`Remove ${p.name}`}
                  className="text-muted"
                  onClick={() => dispatch({ type: "removePerson", personId: p.id })}
                >
                  <TrashIcon />
                </IconButton>
              )}
            </div>
          ))}
          <form
            className="flex items-center gap-2.5 px-3.5 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              dispatch({ type: "addPerson", id: crypto.randomUUID(), name: newName });
              setNewName("");
            }}
          >
            <label htmlFor="new-person" className="sr-only">
              New person&apos;s name
            </label>
            <input
              id="new-person"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Add someone"
              className="h-11 min-w-0 flex-1 rounded-ib border border-stone-300 bg-bg px-3 text-[15px]"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={!newName.trim()}>
              Add
            </Button>
          </form>
        </Card>
      )}
    </section>
  );
}

type ReceiptCardProps = {
  receipt: Receipt;
  openItem: string | null;
  onOpen: (itemId: string | null) => void;
  onAdded: (itemId: string) => void;
};

function ReceiptCard({ receipt, openItem, onOpen, onAdded }: ReceiptCardProps) {
  const { split, dispatch } = useSplit();
  const [expanded, setExpanded] = useState(false);
  const showAll = expanded || receipt.items.findIndex((i) => i.id === openItem) >= COLLAPSED_ITEMS;
  const items = showAll ? receipt.items : receipt.items.slice(0, COLLAPSED_ITEMS);
  const hidden = receipt.items.length - items.length;

  return (
    <Card className="overflow-hidden">
      <div className="p-3.5">
        <div className="text-base font-semibold">{receipt.merchant ?? "Receipt"}</div>
        <div className="text-[13px] text-muted">{receipt.items.length} items · tap an item to assign</div>
      </div>
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          shares={split.assignments.find((a) => a.itemId === item.id)?.shares}
          people={split.people}
          flags={split.flags.filter((f) => f.itemId === item.id && !f.resolved)}
          open={openItem === item.id}
          onOpenChange={(open) => onOpen(open ? item.id : null)}
          onToggle={(personId) => dispatch({ type: "toggleShare", itemId: item.id, personId })}
          onWeight={(personId, weight) => dispatch({ type: "setWeight", itemId: item.id, personId, weight })}
          onEdit={(edit) => dispatch({ type: "editItem", itemId: item.id, ...edit })}
          onDelete={() => dispatch({ type: "removeItem", itemId: item.id })}
        />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="h-12 w-full border-t border-divider bg-white text-sm font-semibold text-primary"
        >
          Show {hidden} more {hidden === 1 ? "item" : "items"}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          const id = crypto.randomUUID();
          dispatch({ type: "addItem", receiptId: receipt.id, id });
          onAdded(id);
        }}
        className="h-12 w-full border-t border-divider bg-white text-sm font-semibold text-primary"
      >
        + Add item
      </button>
    </Card>
  );
}

function MethodPills({ charge, label }: { charge: ChargeKind; label: string }) {
  const { split, dispatch } = useSplit();
  const methods: [SplitMethod, string][] = [
    ["proportional", "Proportional"],
    ["equal", "Equal"],
  ];
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {methods.map(([method, text]) => (
        <Pill key={method} on={split.charges[charge] === method} onClick={() => dispatch({ type: "setChargeMethod", charge, method })}>
          {text}
        </Pill>
      ))}
    </div>
  );
}

function Charges() {
  const { split, dispatch } = useSplit();
  const total = (key: "taxCents" | "tipCents" | "serviceChargeCents") =>
    split.receipts.reduce((sum, r) => sum + (r[key] ?? 0), 0);
  const tax = total("taxCents");
  const printedTip = total("tipCents");
  const service = total("serviceChargeCents");
  const override = split.charges.tipOverride;
  const [customOpen, setCustomOpen] = useState(override?.kind === "amount");

  const preset = !override ? (printedTip > 0 ? null : 0) : override.kind === "percent" ? override.value : null;
  const tipSelected = (p: number) => !customOpen && preset === p;
  const hasTip = override ? override.value > 0 : printedTip > 0;
  const setPercent = (value: number) => {
    setCustomOpen(false);
    dispatch({ type: "setTipOverride", tipOverride: { kind: "percent", value } });
  };

  return (
    <Card className="flex flex-col gap-3.5 p-3.5">
      <SectionLabel>Tax and tip</SectionLabel>
      <div className="flex items-center justify-between text-[15px]">
        <span>Tax</span>
        <span className="font-semibold">{formatCents(tax)}</span>
      </div>
      <MethodPills charge="tax" label="Split tax" />

      {service > 0 && (
        <>
          <div className="flex items-center justify-between border-t border-divider pt-3.5 text-[15px]">
            <span>Service charge</span>
            <span className="font-semibold">{formatCents(service)}</span>
          </div>
          <MethodPills charge="service" label="Split service charge" />
        </>
      )}

      <div className="flex items-center justify-between border-t border-divider pt-3.5">
        <span className="text-[15px]">Tip</span>
        <span className="text-sm text-muted">
          {printedTip > 0 ? `${formatCents(printedTip)} on receipt` : "None on receipt"}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tip">
        <Pill on={tipSelected(0)} onClick={() => setPercent(0)}>
          None
        </Pill>
        {TIP_PERCENTS.map((p) => (
          <Pill key={p} on={tipSelected(p)} onClick={() => setPercent(p)}>
            {p}%
          </Pill>
        ))}
        <Pill on={customOpen || (preset === null && !!override)} onClick={() => setCustomOpen(true)}>
          Custom
        </Pill>
      </div>
      {customOpen && (
        <div className="flex items-center gap-2">
          <label htmlFor="custom-tip" className="text-[15px]">
            Tip amount $
          </label>
          <input
            id="custom-tip"
            inputMode="decimal"
            autoFocus
            defaultValue={override?.kind === "amount" ? (override.value / 100).toFixed(2) : ""}
            onChange={(e) => {
              const dollars = Number(e.target.value);
              if (e.target.value.trim() && Number.isFinite(dollars) && dollars >= 0) {
                dispatch({ type: "setTipOverride", tipOverride: { kind: "amount", value: toCents(dollars) } });
              }
            }}
            className="h-11 w-28 rounded-ib border border-stone-300 bg-bg px-3 text-[15px]"
          />
        </div>
      )}
      {hasTip && <MethodPills charge="tip" label="Split tip" />}
    </Card>
  );
}
