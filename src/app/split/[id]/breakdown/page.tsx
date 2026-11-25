"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSplit } from "@/components/split-store";
import { Avatar, BottomBar, Button, Card, TopBar } from "@/components/ui";
import { fractionWord, shareSuffix, splitTitle } from "@/lib/display";
import { calculate } from "@/lib/calculator";
import { formatCents } from "@/lib/money";
import type { PersonBreakdown, Split } from "@/lib/schemas";
import { canCalculate } from "@/lib/validator";

// Text, Venmo and Copy link are wired in phase 10.
export default function BreakdownPage() {
  const { split } = useSplit();
  const router = useRouter();
  const back = `/split/${split.id}/review`;

  if (!canCalculate(split.flags) || split.receipts.length === 0) {
    return (
      <>
        <TopBar title="Breakdown" subtitle="Step 3 of 3 · Send" backHref={back} backLabel="Back to review" />
        <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-muted">Some things still need fixing before we can work out who owes what.</p>
          <Link href={back} className="font-semibold text-primary hover:text-primary-hover">
            Back to review
          </Link>
        </main>
      </>
    );
  }

  const breakdown = calculate(split);
  const host = breakdown.perPerson.find((p) => p.personId === split.hostId);
  const owed = breakdown.grandTotalCents - (host?.totalCents ?? 0);

  return (
    <>
      <TopBar title="Breakdown" subtitle="Step 3 of 3 · Send" backHref={back} backLabel="Back to review" />
      <main className="flex flex-1 flex-col gap-3.5 px-5 pt-3 pb-5">
        <div className="rounded-card bg-primary px-4 py-4.5 text-white">
          <div className="text-sm opacity-90">
            {splitTitle(split)} · {split.people.length} people · {formatCents(breakdown.grandTotalCents)}
          </div>
          <div className="mt-1.5 font-heading text-[30px] font-bold">You&apos;re owed {formatCents(owed)}</div>
        </div>
        {breakdown.perPerson.map((pb) => (
          <PersonCard key={pb.personId} split={split} pb={pb} />
        ))}
      </main>
      <BottomBar className="flex gap-2.5">
        <Button variant="secondary" className="flex-1">
          Copy link
        </Button>
        <Button variant="dark" className="flex-1" onClick={() => router.push("/")}>
          Done
        </Button>
      </BottomBar>
    </>
  );
}

function PersonCard({ split, pb }: { split: Split; pb: PersonBreakdown }) {
  const [open, setOpen] = useState(false);
  const index = split.people.findIndex((p) => p.id === pb.personId);
  const person = split.people[index];
  const isHost = person.id === split.hostId;
  const items = split.receipts.flatMap((r) => r.items);
  const nameOf = (id: string) => (id === split.hostId ? "You" : (split.people.find((p) => p.id === id)?.name ?? "Someone"));
  const covered = split.rules.flatMap((r) =>
    r.type === "covers_fraction" && r.beneficiary === person.id ? [`${nameOf(r.payer)} covered ${fractionWord(r.fraction)}`] : [],
  );
  const subtitle = isHost ? "Your share" : covered.join(", ");
  const charge = (label: string, cents: number, total: number) =>
    cents !== 0 && { label: total ? `${label} (share of ${formatCents(total)})` : label, cents };
  const receiptsSum = (key: "taxCents" | "serviceChargeCents") => split.receipts.reduce((s, r) => s + (r[key] ?? 0), 0);

  const lines = [
    ...pb.items.map((line) => {
      const item = items.find((i) => i.id === line.itemId)!;
      const shares = split.assignments.find((a) => a.itemId === line.itemId)?.shares ?? {};
      return { label: item.name + shareSuffix(item, shares, person.id), cents: line.amountCents, muted: false };
    }),
    ...[
      charge("Tax", pb.taxCents, receiptsSum("taxCents")),
      charge("Tip", pb.tipCents, 0),
      charge("Service charge", pb.serviceCents, receiptsSum("serviceChargeCents")),
      charge(pb.adjustmentsCents < 0 ? "Covered by others" : "Covering others", pb.adjustmentsCents, 0),
    ].flatMap((l) => (l ? [{ ...l, muted: true }] : [])),
  ];

  return (
    <Card className="flex flex-col gap-3 p-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2.5">
          <Avatar name={person.name} index={index} size="lg" />
          <span>
            <span className="block text-base font-semibold">{isHost ? "You" : person.name}</span>
            {subtitle && <span className="block text-[13px] text-muted">{subtitle}</span>}
          </span>
        </span>
        <span className="font-heading text-[22px] font-bold">{formatCents(pb.totalCents)}</span>
      </button>
      {open && (
        <div className="border-t border-divider pt-2">
          {lines.map((l, i) => (
            <div key={i} className={`flex justify-between gap-3 py-1 text-sm ${l.muted ? "text-muted" : ""}`}>
              <span>{l.label}</span>
              <span>{formatCents(l.cents)}</span>
            </div>
          ))}
        </div>
      )}
      {!isHost && (
        <div className="flex gap-2">
          <Button size="sm" className="flex-1">
            Text
          </Button>
          <Button size="sm" variant="secondary" className="flex-1">
            Venmo
          </Button>
        </div>
      )}
    </Card>
  );
}
