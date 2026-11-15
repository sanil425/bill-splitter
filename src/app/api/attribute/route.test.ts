import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttributionResponse } from "@/lib/schemas";

vi.mock("@/lib/ai/attribute", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/ai/attribute")>()),
  attribute: vi.fn(),
}));

const { attribute, AttributionError } = await import("@/lib/ai/attribute");
const { POST } = await import("./route");
const mockAttribute = vi.mocked(attribute);

const body = {
  items: [
    { id: "i1", receiptId: "r1", name: "Burger", rawText: "BURGER 16.00", lineTotalCents: 1600, confidence: 0.9 },
    { id: "i2", receiptId: "r1", name: "Salad", rawText: "SALAD 13.00", lineTotalCents: 1300, confidence: 0.9 },
  ],
  messages: ["I had the salad, Josh had the burger. I'll cover half of Josh's"],
  hostName: "Maya",
};

const aiResponse: AttributionResponse = {
  people: [{ name: "Maya", isHost: true }, { name: "Josh" }],
  assignments: [
    { itemId: "i1", shares: [{ person: "Josh", weight: 1 }] },
    { itemId: "i2", shares: [{ person: "Maya", weight: 1 }] },
  ],
  rules: [{ type: "covers_fraction", payer: "Maya", beneficiary: "Josh", fraction: 0.5 }],
  charges: { tipOverride: { kind: "amount", value: 5.5 } },
  flags: [{ severity: "warning", message: "Check the burger", itemId: "i1" }],
};

const post = (payload: unknown) =>
  POST(
    new Request("http://localhost/api/attribute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );

beforeEach(() => {
  mockAttribute.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/attribute", () => {
  it("returns 400 for a body that isn't JSON or doesn't match the schema", async () => {
    for (const bad of ["not json", {}, { ...body, messages: [] }, { ...body, hostName: " " }, { ...body, items: [{ id: "x" }] }]) {
      const res = await post(bad);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("BAD_REQUEST");
    }
    expect(mockAttribute).not.toHaveBeenCalled();
  });

  it("rejects duplicate item ids", async () => {
    const res = await post({ ...body, items: [body.items[0], body.items[0]] });
    expect(res.status).toBe(400);
  });

  it("returns domain objects on success", async () => {
    mockAttribute.mockResolvedValue(aiResponse);
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(mockAttribute).toHaveBeenCalledWith(body);

    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual(["assignments", "charges", "flags", "people", "rules"]);

    const [maya, josh] = json.people;
    expect(maya).toEqual({ id: expect.any(String), name: "Maya", isHost: true });
    expect(josh).toEqual({ id: expect.any(String), name: "Josh", isHost: false });
    expect(json.assignments).toEqual([
      { itemId: "i1", shares: { [josh.id]: 1 } },
      { itemId: "i2", shares: { [maya.id]: 1 } },
    ]);
    expect(json.rules).toEqual([{ type: "covers_fraction", payer: maya.id, beneficiary: josh.id, fraction: 0.5 }]);
    expect(json.charges).toEqual({ tax: "proportional", tip: "proportional", service: "proportional", tipOverride: { kind: "amount", value: 550 } });
    expect(json.flags).toEqual([
      expect.objectContaining({ code: "MODEL_FLAG", source: "attribution", confirmable: true, itemId: "i1", resolved: false }),
    ]);
  });

  it("returns 502 without internals when the model fails", async () => {
    mockAttribute.mockRejectedValue(new AttributionError("INVALID_RESPONSE", "The AI response didn't pass validation", ["secret detail"]));
    const res = await post(body);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json).toEqual({ error: { code: "INVALID_RESPONSE", message: "The AI response didn't pass validation" } });
    expect(JSON.stringify(json)).not.toContain("secret detail");
  });

  it("returns 500 without a stack trace for anything unexpected", async () => {
    mockAttribute.mockRejectedValue(new Error("boom at line 42"));
    const res = await post(body);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("boom");
    expect(text).not.toContain("at ");
  });
});
