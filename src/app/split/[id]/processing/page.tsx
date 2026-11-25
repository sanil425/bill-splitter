"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSplit } from "@/components/split-store";
import { Button, CheckIcon } from "@/components/ui";
import { hasPendingVoice, runPipeline, type StepId, type StepState } from "@/lib/pipeline";
import { blobs } from "@/lib/store/blobs";

const LABELS: Record<StepId, string> = {
  receipts: "Reading receipts",
  voice: "Transcribing voice notes",
  attribution: "Matching people to items",
};

export default function ProcessingPage() {
  const { split, dispatch } = useSplit();
  const router = useRouter();
  const [steps, setSteps] = useState<Partial<Record<StepId, StepState>>>({});
  const [run, setRun] = useState(0); // bumped by Retry
  const latest = useRef(split);
  useEffect(() => {
    latest.current = split;
  });

  useEffect(() => {
    const controller = new AbortController();
    const start = latest.current;
    runPipeline(start, {
      fetch,
      blob: (id) => blobs.get(id),
      signal: controller.signal,
      onStep: (id, state) => setSteps((s) => ({ ...s, [id]: state })),
      onSplit: (next) => dispatch({ type: "replace", split: next }),
    }).then((done) => {
      if (done) router.replace(`/split/${done.id}/review`);
    });
    // Leaving the page (or React's dev double-run) cancels in-flight requests.
    // Cache Components keeps this page's state, so clear it for the next visit.
    return () => {
      controller.abort();
      setSteps({});
    };
  }, [run, dispatch, router]);

  const shown: StepId[] = steps.voice || hasPendingVoice(split) ? ["receipts", "voice", "attribution"] : ["receipts", "attribution"];

  return (
    <main className="flex flex-1 flex-col justify-center gap-9 px-7 py-8">
      <div>
        <h1 className="font-heading text-[28px] font-bold tracking-tight">Working it out</h1>
        <p className="mt-1.5 text-[15px] text-muted">This usually takes 10–20 seconds.</p>
      </div>
      <ol className="flex flex-col gap-5.5" aria-live="polite">
        {shown.map((id) => {
          const { status, error } = steps[id] ?? { status: "todo" };
          return (
            <li key={id} className="flex items-start gap-3.5">
              {status === "done" && (
                <span className="flex size-8 flex-none items-center justify-center rounded-full bg-primary text-white">
                  <CheckIcon />
                </span>
              )}
              {status === "active" && (
                <span className="size-8 flex-none animate-spin rounded-full border-3 border-emerald-200 border-t-primary" />
              )}
              {status === "error" && (
                <span className="flex size-8 flex-none items-center justify-center rounded-full bg-fix font-bold text-white" aria-hidden="true">
                  !
                </span>
              )}
              {status === "todo" && <span className="size-8 flex-none rounded-full border-2 border-stone-300" />}
              <div className="flex flex-1 flex-col gap-1">
                <div className={`text-base font-semibold ${status === "todo" ? "text-muted" : ""}`}>{LABELS[id]}</div>
                {status === "active" && <div className="text-sm text-muted">In progress</div>}
                {status === "done" && <div className="text-sm text-muted">Done</div>}
                {status === "error" && (
                  <>
                    <p role="alert" className="text-sm whitespace-pre-line text-fix">
                      {error}
                    </p>
                    <Button size="sm" variant="secondary" className="mt-1 self-start" onClick={() => setRun(run + 1)}>
                      Retry
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <Link
        href={`/split/${split.id}/capture`}
        className="-ml-2 self-start px-2 py-3 text-[15px] font-semibold text-primary hover:text-primary-hover"
      >
        Cancel
      </Link>
    </main>
  );
}
