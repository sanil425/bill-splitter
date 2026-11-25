import type { Flag } from "@/lib/schemas";
import { isResolvable } from "@/lib/validator";
import { Card } from "./ui";

type Props = { flags: readonly Flag[]; onResolve: (id: string) => void; onPick: (itemId: string) => void };

/**
 * Unresolved flags, blocking first. Blocking flags about an item get "Pick" (opens the item);
 * confirmable ones get a confirm button. An AI note about an unassigned item is shown under the
 * "unassigned" flag instead of as its own row (it resolves itself once the item is assigned).
 */
export function FlagBanner({ flags, onResolve, onPick }: Props) {
  const unassigned = new Set(flags.filter((f) => f.code === "ITEM_UNASSIGNED").map((f) => f.itemId));
  const isNote = (f: Flag) => f.source === "attribution" && unassigned.has(f.itemId);
  const notes = (f: Flag) => (f.code === "ITEM_UNASSIGNED" ? flags.filter((n) => isNote(n) && n.itemId === f.itemId) : []);
  const sorted = flags
    .filter((f) => !isNote(f))
    .sort((a, b) => Number(a.severity === "warning") - Number(b.severity === "warning"));
  if (sorted.length === 0) return null;
  return (
    <Card className="divide-y divide-divider overflow-hidden">
      {sorted.map((flag) => {
        const blocking = flag.severity === "blocking";
        return (
          <div key={flag.id} className={`flex items-start gap-2.5 px-3.5 py-3 ${blocking ? "bg-fix-bg" : ""}`}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
              className={`mt-0.5 flex-none ${blocking ? "text-fix" : "text-muted"}`}
            >
              <circle cx="12" cy="12" r="9" />
              <path d={blocking ? "M12 7v6M12 16.5v.5" : "M12 11v6M12 7.5v.5"} />
            </svg>
            <div className="flex-1">
              <div className={`text-xs font-bold tracking-wider uppercase ${blocking ? "text-fix" : "text-muted"}`}>
                {blocking ? "Needs fixing" : "Check"}
              </div>
              <div className="mt-0.5 text-sm">{flag.message}</div>
              {notes(flag).map((n) => (
                <div key={n.id} className="mt-1 text-sm text-muted">
                  {n.message}
                </div>
              ))}
            </div>
            {blocking && flag.itemId && (
              <FlagButton primary onClick={() => onPick(flag.itemId!)}>
                Pick
              </FlagButton>
            )}
            {isResolvable(flag) && (
              <FlagButton primary={blocking && !flag.itemId} onClick={() => onResolve(flag.id)}>
                {blocking ? "Confirm" : "Yes"}
              </FlagButton>
            )}
          </div>
        );
      })}
    </Card>
  );
}

function FlagButton({ primary, onClick, children }: { primary: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative h-9 flex-none rounded-[10px] px-3.5 text-sm font-semibold after:absolute after:-inset-y-1 after:inset-x-0 ${
        primary ? "bg-fix text-white" : "border border-stone-300 bg-white text-ink"
      }`}
    >
      {children}
    </button>
  );
}
