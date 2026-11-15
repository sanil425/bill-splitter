import { beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMIT_DEFAULTS, checkRateLimit, clientIp, rateLimitConfig } from ".";
import { allow, deny, fakeLimiters } from "./test-helpers";

const req = (headers: Record<string, string> = { "x-forwarded-for": "203.0.113.7, 10.0.0.1" }) =>
  new Request("http://localhost/api/x", { method: "POST", headers });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("checkRateLimit", () => {
  it("lets the request through when both limits pass, keyed by client IP", async () => {
    const { limiters, ids } = fakeLimiters();
    expect(await checkRateLimit(req(), limiters)).toBeNull();
    expect(ids.perIp).toEqual(["203.0.113.7"]);
    expect(ids.global).toHaveLength(1);
  });

  it("returns a friendly 429 with Retry-After when the IP is over its limit", async () => {
    const { limiters, ids } = fakeLimiters(deny(5 * 60_000));
    const res = (await checkRateLimit(req(), limiters))!;
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(290);
    const { error } = await res.json();
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.message).toContain("about 5 minutes");
    expect(ids.global).toEqual([]); // the global counter isn't touched
  });

  it("returns 429 DAILY_LIMIT when the global cap is reached", async () => {
    const { limiters } = fakeLimiters(allow, deny(3_600_000));
    const res = (await checkRateLimit(req(), limiters))!;
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("DAILY_LIMIT");
  });

  it("fails closed: 503 when Redis isn't configured, errors, times out or reports a timeout", async () => {
    const cases = [
      null,
      fakeLimiters(new Error("ECONNREFUSED")).limiters,
      fakeLimiters(allow, new Error("WRONGPASS")).limiters,
      fakeLimiters("hang").limiters,
      fakeLimiters({ success: true, reset: 0, reason: "timeout" }).limiters,
    ];
    for (const limiters of cases) {
      const res = (await checkRateLimit(req(), limiters, 20))!;
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("RATE_LIMIT_UNAVAILABLE");
    }
  });
});

describe("clientIp", () => {
  it("uses the first x-forwarded-for entry, then x-real-ip, then 'unknown'", () => {
    expect(clientIp(req())).toBe("203.0.113.7");
    expect(clientIp(req({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(req({}))).toBe("unknown");
  });
});

describe("rateLimitConfig", () => {
  it("uses defaults when unset or invalid", () => {
    expect(rateLimitConfig({})).toEqual(RATE_LIMIT_DEFAULTS);
    expect(rateLimitConfig({ RATE_LIMIT_IP_REQUESTS: "-3", RATE_LIMIT_IP_WINDOW: "soon", RATE_LIMIT_DAILY_CAP: "1.5" })).toEqual(
      RATE_LIMIT_DEFAULTS,
    );
  });

  it("reads overrides from the environment", () => {
    expect(rateLimitConfig({ RATE_LIMIT_IP_REQUESTS: "5", RATE_LIMIT_IP_WINDOW: "1h", RATE_LIMIT_DAILY_CAP: "100" })).toEqual({
      ipRequests: 5,
      ipWindow: "1 h",
      dailyCap: 100,
    });
  });
});
