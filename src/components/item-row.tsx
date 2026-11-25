"use client";

import { itemLabel } from "@/lib/display";
import { formatCents, toCents } from "@/lib/money";
import type { Flag, Item, Person } from "@/lib/schemas";
import { Avatar, Pill } from "./ui";

type Props = {
  item: Item;
  shares: Record<string, number> | undefined;
  people: readonly Person[];
  flags: readonly Flag[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: (personId: string) => void;
  onWeight: (personId: string, weight: number) => void;
  onEdit: (edit: { name?: string; lineTotalCents?: number }) => void;
  onDelete: () => void;
};

/** Row element id, so a flag's "Pick" can scroll to it. */
export const itemRowId = (itemId: string) => `item-${itemId}`;

export function ItemRow({ item, shares = {}, people, flags, open, onOpenChange, onToggle, onWeight, onEdit, onDelete }: Props) {
  const assigned = people.map((p, index) => ({ ...p, index })).filter((p) => p.id in shares);
  const showWeights = assigned.some((p) => shares[p.id] !== 1);
  const needsFix = flags.some((f) => f.severity === "blocking");
  const checkPrice = flags.some((f) => f.code === "LOW_CONFIDENCE");

  return (
    <div id={itemRowId(item.id)} className={`flex scroll-mt-4 flex-col gap-2 border-t border-divider px-3.5 py-3 ${needsFix ? "bg-fix-row" : ""}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="-my-1 flex min-h-11 items-center justify-between gap-3 text-left text-[15px]"
      >
        <span>{itemLabel(item)}</span>
        <span className={`font-semibold ${item.lineTotalCents === null ? "text-fix" : ""}`}>
          {item.lineTotalCents === null ? "No price" : formatCents(item.lineTotalCents)}
        </span>
      </button>

      {!open && (
        <div className="flex flex-wrap items-center gap-1.5">
          {assigned.length === 0 && (
            <span className="rounded-full bg-fix-tag px-2 py-0.5 text-xs font-semibold text-fix">Unassigned</span>
          )}
          {assigned.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1.5">
              <Avatar name={p.name} index={p.index} />
              <span className="sr-only">{p.name}</span>
              {showWeights && <span className="mr-1 text-xs font-semibold text-stone-700">×{shares[p.id]}</span>}
            </span>
          ))}
          {checkPrice && (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-700">Check price</span>
          )}
        </div>
      )}

      {open && (
        <div className="flex flex-col gap-2.5 pt-1">
          <div className="flex gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-muted">
              Name
              <input
                key={item.name}
                defaultValue={item.name}
                onBlur={(e) => e.target.value.trim() !== item.name && onEdit({ name: e.target.value })}
                className="h-11 rounded-ib border border-stone-300 bg-bg px-3 text-[15px] font-normal text-ink"
              />
            </label>
            <label className="flex w-28 flex-col gap-1 text-xs font-semibold text-muted">
              Price $
              <input
                key={item.lineTotalCents}
                inputMode="decimal"
                autoFocus={item.lineTotalCents === null}
                defaultValue={item.lineTotalCents === null ? "" : (item.lineTotalCents / 100).toFixed(2)}
                onBlur={(e) => {
                  const value = e.target.value.trim().replace(/^\$/, "");
                  const dollars = Number(value);
                  if (value && Number.isFinite(dollars)) {
                    const cents = toCents(dollars);
                    if (cents !== item.lineTotalCents) onEdit({ lineTotalCents: cents });
                  }
                }}
                className="h-11 rounded-ib border border-stone-300 bg-bg px-3 text-[15px] font-normal text-ink"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={`Who had ${item.name}`}>
            {people.map((p, index) => (
              <Pill key={p.id} on={p.id in shares} onClick={() => onToggle(p.id)} className="pl-1">
                <Avatar name={p.name} index={index} />
                {p.name}
              </Pill>
            ))}
          </div>
          {assigned.length > 1 &&
            assigned.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <span>{p.name}&apos;s share</span>
                <span className="flex items-center gap-1">
                  <StepButton
                    label={`Less for ${p.name}`}
                    disabled={shares[p.id] <= 1}
                    onClick={() => onWeight(p.id, shares[p.id] - 1)}
                  >
                    −
                  </StepButton>
                  <span className="w-8 text-center font-semibold" aria-live="polite">
                    ×{shares[p.id]}
                  </span>
                  <StepButton label={`More for ${p.name}`} onClick={() => onWeight(p.id, shares[p.id] + 1)}>
                    +
                  </StepButton>
                </span>
              </div>
            ))}
          <button
            type="button"
            onClick={onDelete}
            className="-mb-1 min-h-11 self-start text-sm font-semibold text-fix"
          >
            Delete item
          </button>
        </div>
      )}
    </div>
  );
}

function StepButton({ label, ...props }: { label: string; disabled?: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex size-11 items-center justify-center rounded-ib border border-line bg-white text-lg font-semibold disabled:text-stone-300"
      {...props}
    />
  );
}
