"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { createContext, use, useEffect, useReducer, useSyncExternalStore, type Dispatch, type ReactNode } from "react";
import type { Split } from "@/lib/schemas";
import { splitReducer, type SplitAction } from "@/lib/store/reducer";
import { loadSplit, saveSplit } from "@/lib/store/storage";

const SplitContext = createContext<{ split: Split; dispatch: Dispatch<SplitAction> } | null>(null);

const noopSubscribe = () => () => {};

/** False during server render and hydration, true after: localStorage only exists on the client. */
export function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** Loads the split named by the route's [id] from localStorage. Renders nothing on the server. */
export function SplitProvider({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  if (!useIsClient()) return null;
  const split = loadSplit(id);
  if (!split) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-heading text-xl font-bold">Split not found</p>
        <p className="text-muted">It may have been saved on a different phone.</p>
        <Link href="/" className="font-semibold text-primary hover:text-primary-hover">
          Go home
        </Link>
      </main>
    );
  }
  return (
    <LoadedSplit key={id} initial={split}>
      {children}
    </LoadedSplit>
  );
}

function LoadedSplit({ initial, children }: { initial: Split; children: ReactNode }) {
  const [split, dispatch] = useReducer(splitReducer, initial);
  useEffect(() => saveSplit(split), [split]);
  return <SplitContext value={{ split, dispatch }}>{children}</SplitContext>;
}

export function useSplit() {
  const ctx = use(SplitContext);
  if (!ctx) throw new Error("useSplit must be used inside <SplitProvider>");
  return ctx;
}
