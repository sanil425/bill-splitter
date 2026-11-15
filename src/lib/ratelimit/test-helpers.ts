import type { LimitResult, Limiter, Limiters } from "./limiters";

/** "hang" never resolves (to test the timeout). */
export type FakeOutcome = LimitResult | Error | "hang";

export const allow: LimitResult = { success: true, reset: Date.now() + 60_000 };
export const deny = (resetInMs = 5 * 60_000): LimitResult => ({ success: false, reset: Date.now() + resetInMs });

function fakeLimiter(outcome: FakeOutcome, ids: string[]): Limiter {
  return {
    async limit(id) {
      ids.push(id);
      if (outcome === "hang") return new Promise(() => {});
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
}

export function fakeLimiters(perIp: FakeOutcome = allow, global: FakeOutcome = allow) {
  const ids = { perIp: [] as string[], global: [] as string[] };
  const limiters: Limiters = { perIp: fakeLimiter(perIp, ids.perIp), global: fakeLimiter(global, ids.global) };
  return { limiters, ids };
}
