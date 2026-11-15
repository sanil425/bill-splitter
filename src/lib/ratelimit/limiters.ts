/**
 * Upstash limiters, configured from the environment. Separate from
 * ./index.ts so tests can swap in fakes.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type LimitResult = {
  success: boolean;
  /** Unix ms when the limit resets. */
  reset: number;
  reason?: string;
};
export type Limiter = { limit(identifier: string): Promise<LimitResult> };
export type Limiters = { perIp: Limiter; global: Limiter };

type Duration = `${number} ${"ms" | "s" | "m" | "h" | "d"}`;

export const RATE_LIMIT_DEFAULTS = {
  /** AI calls per IP per window. A typical split is a few receipts + a voice note + attribution, plus retries. */
  ipRequests: 20,
  ipWindow: "10 m" as Duration,
  /** AI calls per day across everyone (UTC day). */
  dailyCap: 500,
};

export function rateLimitConfig(env: Record<string, string | undefined> = process.env) {
  const int = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return v?.trim() && Number.isInteger(n) && n > 0 ? n : fallback;
  };
  const window = env.RATE_LIMIT_IP_WINDOW?.trim().replace(/^(\d+)\s*(ms|s|m|h|d)$/, "$1 $2");
  return {
    ipRequests: int(env.RATE_LIMIT_IP_REQUESTS, RATE_LIMIT_DEFAULTS.ipRequests),
    ipWindow: window && /^\d+ (ms|s|m|h|d)$/.test(window) ? (window as Duration) : RATE_LIMIT_DEFAULTS.ipWindow,
    dailyCap: int(env.RATE_LIMIT_DAILY_CAP, RATE_LIMIT_DEFAULTS.dailyCap),
  };
}

let limiters: Limiters | null | undefined;

/** Null when Redis isn't configured (callers fail closed). */
export function getLimiters(): Limiters | null {
  if (limiters !== undefined) return limiters;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return (limiters = null);

  const redis = new Redis({ url, token, retry: { retries: 1 } });
  const config = rateLimitConfig();
  // timeout: 0 turns off the library's own timeout, which would let requests
  // through (fail open). The caller applies its own timeout and denies instead.
  limiters = {
    perIp: new Ratelimit({
      redis,
      prefix: "splitit:rl:ip",
      limiter: Ratelimit.slidingWindow(config.ipRequests, config.ipWindow),
      timeout: 0,
    }),
    global: new Ratelimit({
      redis,
      prefix: "splitit:rl:global",
      limiter: Ratelimit.fixedWindow(config.dailyCap, "1 d"),
      timeout: 0,
    }),
  };
  return limiters;
}
