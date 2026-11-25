import { describe, expect, it } from "vitest";
import type { Receipt, Split } from "@/lib/schemas";
import { canCalculate } from "@/lib/validator";
import { runPipeline, type StepId, type StepState } from "./pipeline";
import { newSplit } from "./store/splits";

const receipt = (id: string): Receipt => ({
  id,
  merchant: `Cafe ${id}`,
  items: [
    { id: `${id}_1`, receiptId: id, name: "Latte", rawText: "LATTE 5.00", lineTotalCents: 500, confidence: 0.95 },
    { id: `${id}_2`, receiptId: id, name: "Bagel", rawText: "BAGEL 3.00", lineTotalCents: 300, confidence: 0.95 },
  ],
  subtotalCents: 800,
  totalCents: 800,
  unreadableLines: [],
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

/** Fake fetch: each route answers with the next queued handler (the last one repeats). Records every call. */
function fakeFetch(routes: Record<string, ((init: RequestInit) => Response)[]>) {
  const calls: { url: string; body: RequestInit["body"] }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body });
    const queue = routes[url];
    const handler = queue.length > 1 ? queue.shift()! : queue[0];
    return handler(init);
  }) as typeof fetch;
  return { fn, calls, count: (url: string) => calls.filter((c) => c.url === url).length };
}

/** Attribution reply: host had the latte, Ali the bagel. People come back with server-made ids. */
const attributeReply = (init: RequestInit) => {
  const { items, hostName } = JSON.parse(init.body as string) as { items: { id: string }[]; hostName: string };
  return json(200, {
    people: [
      { id: "p_host", name: hostName, isHost: true },
      { id: "p_ali", name: "Ali", isHost: false },
    ],
    assignments: items.map((item, i) => ({ itemId: item.id, shares: { [i % 2 ? "p_ali" : "p_host"]: 1 } })),
    rules: [],
    charges: { tax: "proportional", tip: "proportional", service: "proportional" },
    flags: [],
  });
};

function start(): Split {
  const s = newSplit("s1", "Sanil", "2026-11-25T12:00:00.000Z");
  return {
    ...s,
    inputs: [
      { id: "ph1", kind: "photo" },
      { id: "ph2", kind: "photo" },
      { id: "v1", kind: "voice", transcript: "" },
      { id: "t1", kind: "text", text: "Ali had the bagels" },
    ],
  };
}

function harness(fetchFn: typeof fetch) {
  const steps: Partial<Record<StepId, StepState>> = {};
  const saved: Split[] = [];
  const deps = {
    fetch: fetchFn,
    blob: () => new Blob(["bytes"]),
    onStep: (id: StepId, state: StepState) => (steps[id] = state),
    onSplit: (s: Split) => saved.push(s),
  };
  return { deps, steps, saved };
}

describe("runPipeline", () => {
  it("parses every photo, transcribes voice, attributes, and builds a valid split", async () => {
    let n = 0;
    const f = fakeFetch({
      "/api/parse-receipt": [() => json(200, receipt(`r${++n}`))],
      "/api/transcribe": [() => json(200, { text: "I had the lattes" })],
      "/api/attribute": [attributeReply],
    });
    const { deps, steps, saved } = harness(f.fn);

    const done = await runPipeline(start(), deps);

    expect(done).not.toBeNull();
    expect(steps).toEqual({ receipts: { status: "done" }, voice: { status: "done" }, attribution: { status: "done" } });
    expect(done!.receipts.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(done!.inputs.filter((i) => i.kind === "photo").map((i) => i.receiptId)).toEqual(["r1", "r2"]);
    expect(done!.hostId).toBe("p_host");
    expect(done!.assignments).toHaveLength(4);
    expect(canCalculate(done!.flags)).toBe(true);
    expect(saved.at(-1)).toBe(done);

    const sent = JSON.parse(f.calls.find((c) => c.url === "/api/attribute")!.body as string);
    expect(sent.hostName).toBe("Sanil");
    expect(sent.messages).toEqual(["I had the lattes", "Ali had the bagels"]);
    expect(sent.items).toHaveLength(4);
  });

  it("reports a failed photo with the server's message, keeps the other, and resumes on retry", async () => {
    const f = fakeFetch({
      "/api/parse-receipt": [
        () => json(200, receipt("r1")),
        () => json(429, { error: { code: "RATE_LIMITED", message: "You're going a little fast. Please wait 30 seconds and try again." } }),
        () => json(200, receipt("r2")),
      ],
      "/api/transcribe": [() => json(200, { text: "I had the lattes" })],
      "/api/attribute": [attributeReply],
    });
    const first = harness(f.fn);

    expect(await runPipeline(start(), first.deps)).toBeNull();
    expect(first.steps.receipts).toEqual({
      status: "error",
      error: "Photo 2: You're going a little fast. Please wait 30 seconds and try again.",
    });
    expect(first.steps.attribution).toBeUndefined();
    expect(f.count("/api/attribute")).toBe(0);
    const partial = first.saved.at(-1)!;
    expect(partial.receipts.map((r) => r.id)).toEqual(["r1"]);

    const retry = harness(f.fn);
    const done = await runPipeline(partial, retry.deps);
    expect(done!.receipts.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(f.count("/api/parse-receipt")).toBe(3); // photo 1 wasn't parsed again
    expect(f.count("/api/transcribe")).toBe(1); // nor the voice note
    expect(retry.steps.attribution).toEqual({ status: "done" });
  });

  it("shows a generic message for 502s and network failures, not the server's internals", async () => {
    const f = fakeFetch({
      "/api/parse-receipt": [() => json(200, receipt("r1"))],
      "/api/transcribe": [
        () => {
          throw new TypeError("Failed to fetch");
        },
      ],
      "/api/attribute": [() => json(502, { error: { code: "INVALID_RESPONSE", message: "tool input failed schema" } })],
    });
    const { deps, steps, saved } = harness(f.fn);
    const s = { ...start(), inputs: start().inputs.slice(0, 1).concat(start().inputs.slice(2)) };

    expect(await runPipeline(s, deps)).toBeNull();
    expect(steps.voice?.error).toBe("Couldn't reach SplitIt. Check your connection and try again.");

    const noVoice = { ...saved.at(-1)!, inputs: saved.at(-1)!.inputs.filter((i) => i.kind !== "voice") };
    const second = harness(f.fn);
    expect(await runPipeline(noVoice, second.deps)).toBeNull();
    expect(second.steps.attribution).toEqual({ status: "error", error: "Couldn't work out who had what." });
  });

  it("re-processing keeps parsed receipts and edits, and only re-runs attribution", async () => {
    let n = 0;
    const f = fakeFetch({
      "/api/parse-receipt": [() => json(200, receipt(`r${++n}`))],
      "/api/transcribe": [() => json(200, { text: "I had the lattes" })],
      "/api/attribute": [attributeReply],
    });
    const first = await runPipeline(start(), harness(f.fn).deps);

    // The host renames an item and adds a new message.
    const edited: Split = {
      ...first!,
      receipts: first!.receipts.map((r) => ({ ...r, items: r.items.map((i) => (i.id === "r1_1" ? { ...i, name: "Oat latte" } : i)) })),
      inputs: [...first!.inputs, { id: "t2", kind: "text", text: "Actually Ali had both lattes" }],
    };
    const again = harness(f.fn);
    const done = await runPipeline(edited, again.deps);

    expect(f.count("/api/parse-receipt")).toBe(2);
    expect(f.count("/api/transcribe")).toBe(1);
    expect(f.count("/api/attribute")).toBe(2);
    expect(done!.receipts).toEqual(edited.receipts);
    const sent = JSON.parse(f.calls.at(-1)!.body as string);
    expect(sent.messages).toEqual(["I had the lattes", "Ali had the bagels", "Actually Ali had both lattes"]);
    expect(sent.items[0].name).toBe("Oat latte");
  });

  it("with no notes, gives everything to the host without calling attribution", async () => {
    const f = fakeFetch({ "/api/parse-receipt": [() => json(200, receipt("r1"))] });
    const s = { ...start(), inputs: [{ id: "ph1", kind: "photo" as const }] };
    const done = await runPipeline(s, harness(f.fn).deps);

    expect(f.calls.map((c) => c.url)).toEqual(["/api/parse-receipt"]);
    expect(done!.people).toEqual([{ id: "s1_host", name: "Sanil", isHost: true }]);
    expect(done!.assignments.every((a) => Object.keys(a.shares).join() === "s1_host")).toBe(true);
    expect(canCalculate(done!.flags)).toBe(true);
  });

  it("stops quietly when aborted", async () => {
    const controller = new AbortController();
    const f = fakeFetch({
      "/api/parse-receipt": [
        () => {
          controller.abort();
          throw new DOMException("Aborted", "AbortError");
        },
      ],
    });
    const { deps, saved } = harness(f.fn);
    const s = { ...start(), inputs: [{ id: "ph1", kind: "photo" as const }] };
    expect(await runPipeline(s, { ...deps, signal: controller.signal })).toBeNull();
    expect(saved).toEqual([]);
  });
});
