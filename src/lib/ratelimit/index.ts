/**
 * Rate limiting for the AI routes: a per-IP sliding window plus a global
 * daily cap. Fails closed: if Redis is missing, slow or erroring, the request
 * is refused.
 */
import { errorResponse } from "../http";
import { getLimiters, type Limiter, type Limiters } from "./limiters";

export { rateLimitConfig, RATE_LIMIT_DEFAULTS, type Limiters } from "./limiters";

const REDIS_TIMEOUT_MS = 3000;

export function clientIp(request: Request): string {
  // Vercel sets x-forwarded-for itself (client IP first), so it can't be spoofed there.
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

async function limitWithTimeout(limiter: Limiter, id: string, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("rate limit check timed out")), timeoutMs);
  });
  try {
    const res = await Promise.race([limiter.limit(id), timeout]);
    if (res.reason === "timeout") throw new Error("rate limit check timed out");
    return res;
  } finally {
    clearTimeout(timer);
  }
}

const unavailable = () =>
  errorResponse(503, "RATE_LIMIT_UNAVAILABLE", "SplitIt can't take requests right now. Please try again in a minute.");

/** Null if the request may go ahead; otherwise the response to send (429 or 503). */
export async function checkRateLimit(
  request: Request,
  limiters: Limiters | null = getLimiters(),
  timeoutMs = REDIS_TIMEOUT_MS,
): Promise<Response | null> {
  if (!limiters) {
    console.error("[ratelimit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set; refusing AI requests");
    return unavailable();
  }
  try {
    const ip = await limitWithTimeout(limiters.perIp, clientIp(request), timeoutMs);
    if (!ip.success) {
      const seconds = Math.max(1, Math.ceil((ip.reset - Date.now()) / 1000));
      const minutes = Math.ceil(seconds / 60);
      const wait = seconds < 60 ? "a few seconds" : `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
      return errorResponse(429, "RATE_LIMITED", `You're going a little fast. Please wait ${wait} and try again.`, {}, {
        "Retry-After": String(seconds),
      });
    }

    const global = await limitWithTimeout(limiters.global, "all", timeoutMs);
    if (!global.success) {
      const seconds = Math.max(1, Math.ceil((global.reset - Date.now()) / 1000));
      return errorResponse(429, "DAILY_LIMIT", "SplitIt has reached its limit for today. Please try again tomorrow.", {}, {
        "Retry-After": String(seconds),
      });
    }
    return null;
  } catch (e) {
    console.error("[ratelimit] check failed; refusing request", e instanceof Error ? e.message : e);
    return unavailable();
  }
}
