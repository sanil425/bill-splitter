import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import type { Item } from "../schemas";
import {
  ATTRIBUTION_PROMPT,
  ATTRIBUTION_TOOL_NAME,
  AttributionError,
  attribute,
  buildUserMessage,
  type AttributeInput,
  type MessagesClient,
} from "./attribute";
import { DEFAULT_ATTRIBUTION_MODEL } from "./config";
import { loadPrompt } from "./prompts";

const item = (id: string, name: string, lineTotalCents: number | null): Item => ({
  id,
  receiptId: "r1",
  name,
  rawText: name,
  lineTotalCents,
  confidence: 0.95,
});

const input: AttributeInput = {
  items: [item("i1", "Burger", 1600), item("i2", "Salad", 1300), item("i3", "Mystery", null)],
  messages: ["I had the salad", "Josh had the burger"],
  hostName: "Maya",
};

const valid = {
  people: [{ name: "Maya", isHost: true }, { name: "Josh" }],
  assignments: [
    { itemId: "i1", shares: [{ person: "Josh", weight: 1 }] },
    { itemId: "i2", shares: [{ person: "Maya", weight: 1 }] },
  ],
  flags: [{ severity: "warning", message: "Nobody mentioned the Mystery item.", itemId: "i3" }],
};

let toolUseCounter = 0;
function message(content: unknown[], stop_reason = "tool_use"): BetaMessage {
  return { id: "msg_1", type: "message", role: "assistant", model: "test", content, stop_reason } as unknown as BetaMessage;
}
const toolCall = (toolInput: unknown) =>
  message([
    { type: "text", text: "Here you go." },
    { type: "tool_use", id: `toolu_${++toolUseCounter}`, name: ATTRIBUTION_TOOL_NAME, input: toolInput },
  ]);

/** Returns the queued responses in order and records every request. */
function fakeClient(...responses: (BetaMessage | Error)[]) {
  const calls: MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    async create(params) {
      calls.push(structuredClone(params));
      const next = responses.shift();
      if (!next) throw new Error("fake client: no more responses queued");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { client, calls };
}

async function expectAttributionError(p: Promise<unknown>, code: string): Promise<AttributionError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AttributionError);
  expect((err as AttributionError).code).toBe(code);
  return err as AttributionError;
}

describe("attribute()", () => {
  it("returns the parsed response when the first answer is valid", async () => {
    const { client, calls } = fakeClient(toolCall(valid));
    const res = await attribute(input, { client });
    expect(calls).toHaveLength(1);
    expect(res.people.map((p) => p.name)).toEqual(["Maya", "Josh"]);
    expect(res.rules).toEqual([]); // default filled in
    expect(res.flags[0].itemId).toBe("i3");
  });

  it("retries once with the validation errors, then succeeds", async () => {
    const invalid = { ...valid, assignments: [{ itemId: "i1", shares: [{ person: "Joshua", weight: 0 }] }] };
    const first = toolCall(invalid);
    const { client, calls } = fakeClient(first, toolCall(valid));

    const res = await attribute(input, { client });
    expect(res.assignments).toHaveLength(2);
    expect(calls).toHaveLength(2);

    const retry = calls[1].messages;
    expect(retry).toHaveLength(3);
    // The assistant turn goes back unchanged.
    expect(retry[1]).toEqual({ role: "assistant", content: first.content });
    // Then a tool_result error naming what was wrong.
    const reply = retry[2];
    expect(reply.role).toBe("user");
    const block = (reply.content as { type: string; tool_use_id: string; is_error: boolean; content: string }[])[0];
    expect(block.type).toBe("tool_result");
    expect(block.tool_use_id).toBe((first.content[1] as { id: string }).id);
    expect(block.is_error).toBe(true);
    expect(block.content).toContain('Unknown person "Joshua"');
    expect(block.content).toContain("assignments.0.shares.0.weight");
  });

  it("throws AttributionError after two invalid answers", async () => {
    const { client, calls } = fakeClient(toolCall({ people: [] }), toolCall({ people: [] }));
    const err = await expectAttributionError(attribute(input, { client }), "INVALID_RESPONSE");
    expect(calls).toHaveLength(2);
    expect(err.issues.join("\n")).toContain("people");
  });

  it("treats a reply without the tool call as a failed attempt", async () => {
    const { client, calls } = fakeClient(message([{ type: "text", text: "Maya had the salad." }], "end_turn"), toolCall(valid));
    await attribute(input, { client });
    const reply = calls[1].messages[2];
    expect(reply.content).toEqual([{ type: "text", text: expect.stringContaining(`didn't call ${ATTRIBUTION_TOOL_NAME}`) }]);
  });

  it("rejects item ids it wasn't given, duplicate assignments and a missing host", async () => {
    const bad = {
      people: [{ name: "Josh" }],
      assignments: [
        { itemId: "nope", shares: [{ person: "Josh", weight: 1 }] },
        { itemId: "i1", shares: [{ person: "Josh", weight: 1 }] },
        { itemId: "i1", shares: [{ person: "Josh", weight: 1 }] },
      ],
    };
    const { client } = fakeClient(toolCall(bad), toolCall(bad));
    const err = await expectAttributionError(attribute(input, { client }), "INVALID_RESPONSE");
    const text = err.issues.join("\n");
    expect(text).toContain('"nope" is not one of the item ids given');
    expect(text).toContain('"i1" is assigned more than once');
    expect(text).toContain('{"name": "Maya", "isHost": true}');
  });

  it("wraps API failures, refusals and truncation in AttributionError without retrying", async () => {
    const timeout = fakeClient(new Anthropic.APIConnectionTimeoutError());
    const err = await expectAttributionError(attribute(input, { client: timeout.client }), "API_ERROR");
    expect(err.message).toBe("The AI request timed out");

    const refused = fakeClient(message([], "refusal"));
    await expectAttributionError(attribute(input, { client: refused.client }), "REFUSED");
    expect(refused.calls).toHaveLength(1);

    const truncated = fakeClient(message([], "max_tokens"));
    await expectAttributionError(attribute(input, { client: truncated.client }), "TRUNCATED");
  });
});

describe("attribution request", () => {
  it("loads the v1 prompt from /prompts", () => {
    const prompt = loadPrompt(ATTRIBUTION_PROMPT);
    expect(prompt).toContain(ATTRIBUTION_TOOL_NAME);
    expect(prompt).toContain("never do arithmetic");
    expect(prompt).toContain("covers_fraction");
  });

  it("sends the prompt, the one tool, and the host, items and notes", async () => {
    const { client, calls } = fakeClient(toolCall(valid));
    await attribute(input, { client });
    const req = calls[0];

    expect(req.model).toBe(process.env.ATTRIBUTION_MODEL || DEFAULT_ATTRIBUTION_MODEL);
    expect(req.max_tokens).toBeGreaterThan(0);
    expect(req.system).toEqual([expect.objectContaining({ type: "text", text: loadPrompt(ATTRIBUTION_PROMPT) })]);

    // One tool, schema from Zod. Current models reject a forced tool_choice, so
    // it's "auto" with parallel calls off, and the prompt requires the call.
    expect(req.tools).toHaveLength(1);
    const tool = req.tools![0] as { name: string; input_schema: { type: string; required: string[]; $schema?: string } };
    expect(tool.name).toBe(ATTRIBUTION_TOOL_NAME);
    expect(tool.input_schema.type).toBe("object");
    expect(tool.input_schema.required).toEqual(["people", "assignments"]);
    expect(tool.input_schema.$schema).toBeUndefined();
    expect(req.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });

    const user = req.messages[0];
    expect(user.role).toBe("user");
    const text = user.content as string;
    expect(text).toContain("<host>Maya</host>");
    for (const id of ["i1", "i2", "i3"]) expect(text).toContain(`id: ${id} `);
    expect(text).toContain('"Burger" | $16.00');
    expect(text).toContain("price unreadable");
    expect(text).toContain('1. "I had the salad"');
    expect(text).toContain('2. "Josh had the burger"');
  });

  it("honours a model override", async () => {
    const { client, calls } = fakeClient(toolCall(valid));
    await attribute(input, { client, model: "claude-test" });
    expect(calls[0].model).toBe("claude-test");
  });

  it("says when there are no receipt items", () => {
    expect(buildUserMessage({ ...input, items: [] })).toContain("(no receipt items)");
  });
});
