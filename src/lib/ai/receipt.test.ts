import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { DEFAULT_RECEIPT_MODEL } from "./config";
import { loadPrompt } from "./prompts";
import { RECEIPT_PROMPT, RECEIPT_TOOL_NAME, ReceiptParseError, parseReceipt, type ReceiptImage } from "./receipt";
import { fakeMessagesClient, message, toolCall } from "./test-helpers";
import { AiError } from "./tool-call";

const image: ReceiptImage = { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), mediaType: "image/jpeg" };

const validReceipt = {
  merchant: "Corner Bistro",
  items: [
    { name: "Burger", rawText: "BURGER 16.00", lineTotal: 16, confidence: 0.95 },
    { name: "Salad", rawText: "SALAD 1?.00", lineTotal: null, confidence: 0.4 },
    { name: "Happy Hour", rawText: "HAPPY HR -3.00", lineTotal: -3, confidence: 0.9 },
  ],
  subtotal: 26,
  tax: 2.31,
  total: 28.31,
};

async function expectError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ReceiptParseError);
  expect(err).toBeInstanceOf(AiError);
  expect((err as ReceiptParseError).code).toBe(code);
  return err as ReceiptParseError;
}

describe("parseReceipt()", () => {
  it("returns the parsed receipt on a valid first answer", async () => {
    const { client, calls } = fakeMessagesClient(toolCall(RECEIPT_TOOL_NAME, validReceipt));
    const res = await parseReceipt(image, { client });
    expect(calls).toHaveLength(1);
    expect(res.items.map((i) => i.lineTotal)).toEqual([16, null, -3]);
    expect(res.unreadableLines).toEqual([]); // default filled in
  });

  it("retries once with the validation errors sent back as a tool_result", async () => {
    const bad = { ...validReceipt, items: [{ name: "Burger", rawText: "BURGER", lineTotal: "16.00", confidence: 2 }] };
    const first = toolCall(RECEIPT_TOOL_NAME, bad);
    const { client, calls } = fakeMessagesClient(first, toolCall(RECEIPT_TOOL_NAME, validReceipt));
    await parseReceipt(image, { client });

    expect(calls).toHaveLength(2);
    const retry = calls[1].messages;
    expect(retry[0]).toEqual(calls[0].messages[0]); // same image turn
    expect(retry[1]).toEqual({ role: "assistant", content: first.content });
    const block = (retry[2].content as { type: string; is_error: boolean; content: string }[])[0];
    expect(block.type).toBe("tool_result");
    expect(block.is_error).toBe(true);
    expect(block.content).toContain("items.0.lineTotal");
    expect(block.content).toContain("items.0.confidence");
  });

  it("throws INVALID_RESPONSE after two bad answers, and handles a reply without the tool", async () => {
    const twice = fakeMessagesClient(toolCall(RECEIPT_TOOL_NAME, { items: "none" }), toolCall(RECEIPT_TOOL_NAME, {}));
    const err = await expectError(parseReceipt(image, { client: twice.client }), "INVALID_RESPONSE");
    expect(err.issues.join("\n")).toContain("items");

    const noTool = fakeMessagesClient(message([{ type: "text", text: "A burger." }], "end_turn"), toolCall(RECEIPT_TOOL_NAME, validReceipt));
    await parseReceipt(image, { client: noTool.client });
    expect(noTool.calls[1].messages[2].content).toEqual([{ type: "text", text: expect.stringContaining(`didn't call ${RECEIPT_TOOL_NAME}`) }]);
  });

  it("wraps API errors, refusals and truncation without retrying", async () => {
    const down = fakeMessagesClient(new Anthropic.APIConnectionError({ message: "nope" }));
    expect((await expectError(parseReceipt(image, { client: down.client }), "API_ERROR")).message).toBe("Couldn't reach the AI service");

    const refused = fakeMessagesClient(message([], "refusal"));
    await expectError(parseReceipt(image, { client: refused.client }), "REFUSED");
    expect(refused.calls).toHaveLength(1);

    await expectError(parseReceipt(image, { client: fakeMessagesClient(message([], "max_tokens")).client }), "TRUNCATED");
  });
});

describe("receipt request", () => {
  it("loads the v1 prompt with the key rules", () => {
    const prompt = loadPrompt(RECEIPT_PROMPT);
    expect(prompt).toContain(RECEIPT_TOOL_NAME);
    expect(prompt).toContain("source of truth");
    expect(prompt).toContain("Never invent or guess a price");
    expect(prompt).toContain("Discounts are negative");
  });

  it("sends the image as base64 before the text, with one Zod-derived tool and no fallback", async () => {
    const { client, calls } = fakeMessagesClient(toolCall(RECEIPT_TOOL_NAME, validReceipt));
    await parseReceipt(image, { client });
    const req = calls[0];

    expect(req.model).toBe(process.env.RECEIPT_MODEL || DEFAULT_RECEIPT_MODEL);
    expect(req.system).toEqual([expect.objectContaining({ type: "text", text: loadPrompt(RECEIPT_PROMPT) })]);
    expect(req.tools).toHaveLength(1);
    const tool = req.tools![0] as { name: string; input_schema: { required: string[]; $schema?: string } };
    expect(tool.name).toBe(RECEIPT_TOOL_NAME);
    expect(tool.input_schema.required).toEqual(["items"]);
    expect(tool.input_schema.$schema).toBeUndefined();
    expect(req.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect(req).not.toHaveProperty("fallbacks");

    const [img, text] = req.messages[0].content as { type: string; source?: { media_type: string; data: string } }[];
    expect(img.type).toBe("image");
    expect(img.source).toEqual({ type: "base64", media_type: "image/jpeg", data: Buffer.from(image.data).toString("base64") });
    expect(text.type).toBe("text");
  });

  it("honours a model override", async () => {
    const { client, calls } = fakeMessagesClient(toolCall(RECEIPT_TOOL_NAME, validReceipt));
    await parseReceipt(image, { client, model: "claude-test" });
    expect(calls[0].model).toBe("claude-test");
  });
});
