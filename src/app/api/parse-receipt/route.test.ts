import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECEIPT_TOOL_NAME } from "@/lib/ai/receipt";
import { fakeMessagesClient, message, toolCall } from "@/lib/ai/test-helpers";
import type { Limiters } from "@/lib/ratelimit";
import { deny, fakeLimiters } from "@/lib/ratelimit/test-helpers";
import { MAX_IMAGE_BYTES } from "@/lib/uploads";

// Fake model client and rate limiters; everything else is real.
const fakes = vi.hoisted(() => ({
  client: undefined as unknown,
  limiters: null as Limiters | null,
}));
vi.mock("@/lib/ai/client", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/ai/client")>()),
  getMessagesClient: () => fakes.client,
}));
vi.mock("@/lib/ratelimit/limiters", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/ratelimit/limiters")>()),
  getLimiters: () => fakes.limiters,
}));

const { POST } = await import("./route");

const receipt = {
  merchant: "Corner Bistro",
  items: [
    { name: "Burger", rawText: "BURGER 16.00", lineTotal: 16, quantity: 1, confidence: 0.95 },
    { name: "Salad", rawText: "SALAD 1?.00", lineTotal: null, confidence: 0.4 },
    { name: "Happy Hour", rawText: "HAPPY HR -3.00", lineTotal: -3, confidence: 0.9 },
  ],
  subtotal: 26.5,
  tax: 2.31,
  tip: null,
  total: 28.81,
  unreadableLines: ["SVC ??"],
};

const jpeg = (size = 1000) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};

function post(file?: Uint8Array | string, field = "image") {
  const form = new FormData();
  if (file !== undefined) form.append(field, typeof file === "string" ? file : new File([file as Uint8Array<ArrayBuffer>], "r.jpg"));
  return POST(new Request("http://localhost/api/parse-receipt", { method: "POST", body: form, headers: { "x-forwarded-for": "1.2.3.4" } }));
}

const errorCode = async (res: Response) => (await res.json()).error.code;

beforeEach(() => {
  fakes.limiters = fakeLimiters().limiters;
  fakes.client = fakeMessagesClient().client;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/parse-receipt", () => {
  it("returns a domain Receipt (cents, ids, nulls for unreadable prices)", async () => {
    const fake = fakeMessagesClient(toolCall(RECEIPT_TOOL_NAME, receipt));
    fakes.client = fake.client;
    const res = await post(jpeg());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toEqual({
      id: expect.any(String),
      merchant: "Corner Bistro",
      items: [
        { id: expect.any(String), receiptId: json.id, name: "Burger", rawText: "BURGER 16.00", lineTotalCents: 1600, quantity: 1, confidence: 0.95 },
        { id: expect.any(String), receiptId: json.id, name: "Salad", rawText: "SALAD 1?.00", lineTotalCents: null, confidence: 0.4 },
        { id: expect.any(String), receiptId: json.id, name: "Happy Hour", rawText: "HAPPY HR -3.00", lineTotalCents: -300, confidence: 0.9 },
      ],
      subtotalCents: 2650,
      taxCents: 231,
      totalCents: 2881,
      unreadableLines: ["SVC ??"],
    });
    const img = (fake.calls[0].messages[0].content as { type: string; source: { media_type: string } }[])[0];
    expect(img.source.media_type).toBe("image/jpeg");
  });

  it("retries once when the first answer fails validation", async () => {
    const fake = fakeMessagesClient(toolCall(RECEIPT_TOOL_NAME, { items: [{ name: "Burger" }] }), toolCall(RECEIPT_TOOL_NAME, receipt));
    fakes.client = fake.client;
    const res = await post(jpeg());
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(2);
  });

  it("returns 502 with the code (no internals) when the model fails twice", async () => {
    fakes.client = fakeMessagesClient(toolCall(RECEIPT_TOOL_NAME, {}), toolCall(RECEIPT_TOOL_NAME, {})).client;
    const res = await post(jpeg());
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error.code).toBe("INVALID_RESPONSE");
    expect(json.error).not.toHaveProperty("issues");

    fakes.client = fakeMessagesClient(message([], "refusal")).client;
    expect(await errorCode(await post(jpeg()))).toBe("REFUSED");
  });

  it("returns 422 when no items were found", async () => {
    fakes.client = fakeMessagesClient(toolCall(RECEIPT_TOOL_NAME, { items: [] })).client;
    const res = await post(jpeg());
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("NO_ITEMS");
  });

  it("rejects bad input with 400 before calling the model or the rate limiter", async () => {
    const { limiters, ids } = fakeLimiters();
    fakes.limiters = limiters;
    const fake = fakeMessagesClient();
    fakes.client = fake.client;

    expect(await errorCode(await post())).toBe("BAD_REQUEST"); // no file
    expect(await errorCode(await post("text, not a file"))).toBe("BAD_REQUEST");
    expect(await errorCode(await post(jpeg(), "photo"))).toBe("BAD_REQUEST"); // wrong field
    expect(await errorCode(await post(new Uint8Array()))).toBe("BAD_REQUEST"); // empty
    expect(await errorCode(await post(new TextEncoder().encode("GIF89a.........")))).toBe("UNSUPPORTED_TYPE");

    const twoFiles = new FormData();
    twoFiles.append("image", new File([jpeg()], "a.jpg"));
    twoFiles.append("image", new File([jpeg()], "b.jpg"));
    expect((await POST(new Request("http://localhost/api/parse-receipt", { method: "POST", body: twoFiles }))).status).toBe(400);

    const json = await POST(new Request("http://localhost/api/parse-receipt", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
    expect(json.status).toBe(400);

    expect(fake.calls).toHaveLength(0);
    expect(ids.perIp).toHaveLength(0);
  });

  it("returns 413 for images over 4 MB", async () => {
    const res = await post(jpeg(MAX_IMAGE_BYTES + 1));
    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe("TOO_LARGE");
  });

  it("returns 429 when rate limited, without calling the model", async () => {
    const fake = fakeMessagesClient(toolCall(RECEIPT_TOOL_NAME, receipt));
    fakes.client = fake.client;
    fakes.limiters = fakeLimiters(deny()).limiters;
    const res = await post(jpeg());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(await errorCode(res)).toBe("RATE_LIMITED");
    expect(fake.calls).toHaveLength(0);
  });

  it("fails closed with 503 when Redis isn't available", async () => {
    fakes.limiters = null;
    const res = await post(jpeg());
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe("RATE_LIMIT_UNAVAILABLE");
  });
});
