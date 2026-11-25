import Link from "next/link";
import { calculate } from "@/lib/calculator";
import { shareSuffix, shortDate, splitTitle } from "@/lib/display";
import { formatCents } from "@/lib/money";
import { finishedSampleSplit } from "@/lib/store/splits";

const LINK_DAYS = 30;

// shortcut: every id shows the sample split; phase 10 loads the real one from Redis.
export default function SharePage() {
  const split = finishedSampleSplit();
  const breakdown = calculate(split);
  const host = split.people.find((p) => p.id === split.hostId)!;
  const items = split.receipts.flatMap((r) => r.items);
  const expires = new Date(new Date(split.createdAt).getTime() + LINK_DAYS * 86_400_000).toISOString();

  return (
    <main className="flex flex-1 flex-col gap-5 px-5 py-7">
      <div className="font-heading text-lg font-bold text-primary">SplitIt</div>
      <div>
        <h1 className="font-heading text-[26px] font-bold tracking-tight">{splitTitle(split)}</h1>
        <p className="mt-1 text-[15px] text-muted">
          {shortDate(split.createdAt, true)} · split by {host.name} · {formatCents(breakdown.grandTotalCents)}
        </p>
      </div>

      <div className="divide-y divide-divider overflow-hidden rounded-card border border-line bg-white">
        {breakdown.perPerson.map((pb) => {
          const person = split.people.find((p) => p.id === pb.personId)!;
          return (
            <details key={pb.personId} className="open:bg-[#F7FDFA]">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 font-semibold [&::-webkit-details-marker]:hidden">
                <span>{person.name}</span>
                <span>{formatCents(pb.totalCents)}</span>
              </summary>
              <div className="px-4 pb-3.5">
                {pb.items.map((line) => {
                  const item = items.find((i) => i.id === line.itemId)!;
                  const shares = split.assignments.find((a) => a.itemId === line.itemId)?.shares ?? {};
                  return (
                    <div key={line.itemId} className="flex justify-between py-0.5 text-sm">
                      <span>{item.name + shareSuffix(item, shares, person.id)}</span>
                      <span>{formatCents(line.amountCents)}</span>
                    </div>
                  );
                })}
                {pb.taxCents !== 0 && (
                  <div className="flex justify-between py-0.5 text-sm text-muted">
                    <span>Tax</span>
                    <span>{formatCents(pb.taxCents)}</span>
                  </div>
                )}
                {pb.adjustmentsCents !== 0 && (
                  <div className="flex justify-between py-0.5 text-sm text-muted">
                    <span>{pb.adjustmentsCents < 0 ? "Covered by others" : "Covering others"}</span>
                    <span>{formatCents(pb.adjustmentsCents)}</span>
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>

      <p className="text-[13px] leading-normal text-muted">
        Tap a name to see what they had. Tax is split in proportion to what each person ordered.
      </p>
      <div className="flex-1" />
      <p className="text-center text-[13px] text-muted">
        This link expires on {shortDate(expires)}.{" "}
        <Link href="/" className="font-semibold text-primary hover:text-primary-hover">
          Make your own split
        </Link>
      </p>
    </main>
  );
}
