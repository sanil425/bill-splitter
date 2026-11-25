"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useIsClient } from "@/components/split-store";
import { Button, CameraIcon, SectionLabel } from "@/components/ui";
import { printedTotalCents, shortDate, splitTitle } from "@/lib/display";
import { formatCents } from "@/lib/money";
import { listSplits, loadName, saveName, saveSplit } from "@/lib/store/storage";
import { newSplit, sampleSplit } from "@/lib/store/splits";
import { canCalculate } from "@/lib/validator";

export default function Home() {
  if (!useIsClient()) return null;
  return <HomeScreen />;
}

function HomeScreen() {
  const router = useRouter();
  const [name, setName] = useState(loadName);
  const splits = listSplits();

  if (!name) return <NamePrompt onDone={setName} />;

  function startSplit() {
    const split = newSplit(crypto.randomUUID(), name!);
    // Dev: /?sample=1 makes "New split" open the sample Osushi split instead.
    if (new URLSearchParams(location.search).has("sample")) {
      saveSplit(sampleSplit(split));
      return router.push(`/split/${split.id}/review`);
    }
    saveSplit(split);
    router.push(`/split/${split.id}/capture`);
  }

  return (
    <main className="flex flex-1 flex-col gap-7 px-5 py-6">
      <div className="pt-6">
        <h1 className="font-heading text-[30px] font-bold tracking-tight">SplitIt</h1>
        <p className="mt-1 text-[15px] text-muted">Hi {name}</p>
      </div>

      <button
        type="button"
        onClick={startSplit}
        className="flex flex-col gap-3.5 rounded-[20px] bg-primary px-5 py-6 text-left text-white hover:bg-primary-hover"
      >
        <CameraIcon size={32} />
        <span className="font-heading text-2xl font-bold">New split</span>
        <span className="text-[15px] opacity-90">Snap the receipt, then say or type who had what.</span>
      </button>

      <section className="flex flex-col gap-3">
        <SectionLabel>Recent</SectionLabel>
        {splits.map((split) => {
          const ready = split.receipts.length > 0 && canCalculate(split.flags);
          const total = printedTotalCents(split);
          return (
            <Link
              key={split.id}
              href={`/split/${split.id}/${split.receipts.length ? "review" : "capture"}`}
              className="flex flex-col gap-1.5 rounded-card border border-line bg-white p-4 text-ink"
            >
              <span className="flex items-center justify-between gap-3 text-base font-semibold">
                <span>{splitTitle(split)}</span>
                {total > 0 && <span>{formatCents(total)}</span>}
              </span>
              <span className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted">
                  {shortDate(split.createdAt)} · {split.people.length} {split.people.length === 1 ? "person" : "people"}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${
                    ready ? "bg-primary-tint text-primary-hover" : "bg-stone-100 text-stone-700"
                  }`}
                >
                  {ready ? "Ready" : "Draft"}
                </span>
              </span>
            </Link>
          );
        })}
        <p className="pt-2 text-center text-[13px] text-muted">Splits are saved on this phone only.</p>
      </section>
    </main>
  );
}

function NamePrompt({ onDone }: { onDone: (name: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <main className="flex flex-1 flex-col justify-center gap-6 px-5 py-6">
      <div>
        <h1 className="font-heading text-[30px] font-bold tracking-tight">SplitIt</h1>
        <p className="mt-1 text-[15px] text-muted">Snap the receipt, say who had what, and everyone gets their share.</p>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const name = value.trim();
          if (!name) return;
          saveName(name);
          onDone(name);
        }}
      >
        <label htmlFor="name" className="font-semibold">
          What&apos;s your name?
        </label>
        <input
          id="name"
          autoFocus
          autoComplete="given-name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-12 rounded-btn border border-stone-300 bg-white px-3.5 text-[15px]"
        />
        <p className="text-[13px] text-muted">Friends see this on the breakdown you send them.</p>
        <Button type="submit" disabled={!value.trim()}>
          Continue
        </Button>
      </form>
    </main>
  );
}
