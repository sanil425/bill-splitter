/**
 * Attribution: one model call that reads the host's notes and says who had
 * which items. The model only extracts; it never does arithmetic. Its output
 * is validated with Zod (plus a few checks against what we sent), and on
 * failure we retry once with the errors sent back to the model.
 */
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { formatCents } from "../money";
import { AttributionResponseSchema, type AttributionResponse, type Item } from "../schemas";
import { getMessagesClient, type MessagesClient } from "./client";
import { ATTRIBUTION_MAX_TOKENS, attributionModel } from "./config";
import { loadPrompt } from "./prompts";
import { AiError, callTool, toolFromSchema, zodProblems, type Checked } from "./tool-call";

export const ATTRIBUTION_PROMPT = "attribution.v2";
export const ATTRIBUTION_TOOL_NAME = "submit_attribution";

export class AttributionError extends AiError {
  override readonly name = "AttributionError";
}

export type AttributeInput = {
  items: readonly Item[];
  /** The host's notes, oldest first. */
  messages: readonly string[];
  hostName: string;
};

export type AttributeOptions = {
  client?: MessagesClient;
  model?: string;
};

export const ATTRIBUTION_TOOL = toolFromSchema(
  ATTRIBUTION_TOOL_NAME,
  "Submit who had which items, any custom payment rules, charge settings, and flags for anything unclear. " +
    "Call this exactly once with your complete answer.",
  AttributionResponseSchema,
);

export function buildUserMessage({ items, messages, hostName }: AttributeInput): string {
  const itemLines = items.length
    ? items.map((i) => {
        const price = i.lineTotalCents === null ? "price unreadable" : formatCents(i.lineTotalCents);
        const qty = i.quantity !== undefined && i.quantity !== 1 ? ` | qty ${i.quantity}` : "";
        return `- id: ${i.id} | ${JSON.stringify(i.name)} | ${price}${qty} | receipt ${i.receiptId}`;
      })
    : ["(no receipt items)"];
  const noteLines = messages.map((m, i) => `${i + 1}. ${JSON.stringify(m)}`);

  return [
    `<host>${hostName}</host>`,
    "",
    "<items>",
    ...itemLines,
    "</items>",
    "",
    "<messages>",
    ...noteLines,
    "</messages>",
    "",
    `Call ${ATTRIBUTION_TOOL_NAME} with your answer.`,
  ].join("\n");
}

export function buildRequest(model = attributionModel()): Omit<MessageCreateParamsNonStreaming, "messages"> {
  return {
    model,
    max_tokens: ATTRIBUTION_MAX_TOKENS,
    system: [{ type: "text", text: loadPrompt(ATTRIBUTION_PROMPT), cache_control: { type: "ephemeral" } }],
    tools: [ATTRIBUTION_TOOL],
    // Current models reject a forced tool_choice ("tool"/"any"), so the prompt
    // requires the call, and a reply without it counts as a failed attempt.
    tool_choice: { type: "auto", disable_parallel_tool_use: true },
  };
}

/** Problems Zod can't see because they depend on what we sent. */
function checkAgainstInput(res: AttributionResponse, input: AttributeInput): string[] {
  const problems: string[] = [];
  const itemIds = new Set(input.items.map((i) => i.id));
  const seen = new Set<string>();
  res.assignments.forEach((a, i) => {
    if (!itemIds.has(a.itemId)) problems.push(`assignments[${i}].itemId: "${a.itemId}" is not one of the item ids given`);
    if (seen.has(a.itemId)) problems.push(`assignments[${i}].itemId: "${a.itemId}" is assigned more than once; combine the shares`);
    seen.add(a.itemId);
  });
  res.flags.forEach((f, i) => {
    if (f.itemId != null && !itemIds.has(f.itemId)) problems.push(`flags[${i}].itemId: "${f.itemId}" is not one of the item ids given`);
  });
  const hosts = res.people.filter((p) => p.isHost);
  if (hosts.length !== 1 || hosts[0].name !== input.hostName) {
    problems.push(`people: include the host exactly once as {"name": ${JSON.stringify(input.hostName)}, "isHost": true}`);
  }
  return problems;
}

function check(raw: unknown, input: AttributeInput): Checked<AttributionResponse> {
  const parsed = AttributionResponseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: zodProblems(parsed.error) };
  const problems = checkAgainstInput(parsed.data, input);
  return problems.length ? { ok: false, problems } : { ok: true, value: parsed.data };
}

export function attribute(input: AttributeInput, opts: AttributeOptions = {}): Promise<AttributionResponse> {
  return callTool({
    client: opts.client ?? getMessagesClient(),
    request: buildRequest(opts.model),
    userContent: buildUserMessage(input),
    toolName: ATTRIBUTION_TOOL_NAME,
    check: (raw) => check(raw, input),
    ErrorClass: AttributionError,
  });
}
