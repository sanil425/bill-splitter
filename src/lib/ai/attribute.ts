/**
 * Attribution: one model call that reads the host's notes and says who had
 * which items. The model only extracts; it never does arithmetic. Its output
 * is validated with Zod (plus a few checks against what we sent), and on
 * failure we retry once with the errors sent back to the model.
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTool,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { formatCents } from "../money";
import { AttributionResponseSchema, type AttributionResponse, type Item } from "../schemas";
import {
  ATTRIBUTION_MAX_TOKENS,
  FALLBACK_BETA,
  REQUEST_TIMEOUT_MS,
  SDK_MAX_RETRIES,
  attributionModel,
} from "./config";
import { loadPrompt } from "./prompts";

export const ATTRIBUTION_PROMPT = "attribution.v1";
export const ATTRIBUTION_TOOL_NAME = "submit_attribution";
const MAX_ATTEMPTS = 2;

/** The one SDK method we use. Injectable so tests run without a network. */
export type MessagesClient = {
  create(params: MessageCreateParamsNonStreaming): Promise<BetaMessage>;
};

let defaultClient: MessagesClient | undefined;
function getDefaultClient(): MessagesClient {
  if (!defaultClient) {
    // Reads ANTHROPIC_API_KEY from the environment.
    const anthropic = new Anthropic({ timeout: REQUEST_TIMEOUT_MS, maxRetries: SDK_MAX_RETRIES });
    defaultClient = { create: (params) => anthropic.beta.messages.create(params) };
  }
  return defaultClient;
}

export type AttributionErrorCode =
  /** Network error, timeout, or an error status from the API. */
  | "API_ERROR"
  /** The model (and any fallback) declined the request. */
  | "REFUSED"
  /** The response hit max_tokens before finishing. */
  | "TRUNCATED"
  /** The model's answer failed validation twice. */
  | "INVALID_RESPONSE";

export class AttributionError extends Error {
  override readonly name = "AttributionError";
  constructor(
    readonly code: AttributionErrorCode,
    message: string,
    /** Validation problems from the last attempt (INVALID_RESPONSE only). */
    readonly issues: string[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
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

// The tool's input schema is generated from the Zod schema, so the two can't drift.
// "input" mode: fields with defaults (rules, flags) are optional for the model.
const { $schema: _, ...attributionJsonSchema } = z.toJSONSchema(AttributionResponseSchema, { io: "input" });

export const ATTRIBUTION_TOOL: BetaTool = {
  name: ATTRIBUTION_TOOL_NAME,
  description:
    "Submit who had which items, any custom payment rules, charge settings, and flags for anything unclear. " +
    "Call this exactly once with your complete answer.",
  input_schema: attributionJsonSchema as BetaTool["input_schema"],
};

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

export function buildRequest(
  input: AttributeInput,
  messages: BetaMessageParam[],
  model = attributionModel(),
): MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: ATTRIBUTION_MAX_TOKENS,
    system: [{ type: "text", text: loadPrompt(ATTRIBUTION_PROMPT), cache_control: { type: "ephemeral" } }],
    tools: [ATTRIBUTION_TOOL],
    // Current models reject a forced tool_choice ("tool"/"any"), so the prompt
    // requires the call, and a reply without it counts as a failed attempt.
    tool_choice: { type: "auto", disable_parallel_tool_use: true },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    messages: [...messages],
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

type Attempt = { ok: true; value: AttributionResponse } | { ok: false; problems: string[]; toolUseId?: string };

function readAttempt(res: BetaMessage, input: AttributeInput): Attempt {
  const toolUse = res.content.find((b) => b.type === "tool_use" && b.name === ATTRIBUTION_TOOL_NAME);
  if (!toolUse || toolUse.type !== "tool_use") {
    return { ok: false, problems: [`You didn't call ${ATTRIBUTION_TOOL_NAME}. Call it now with your complete answer.`] };
  }
  const parsed = AttributionResponseSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`), toolUseId: toolUse.id };
  }
  const problems = checkAgainstInput(parsed.data, input);
  return problems.length ? { ok: false, problems, toolUseId: toolUse.id } : { ok: true, value: parsed.data };
}

function describeApiError(e: unknown): string {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "The AI request timed out";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach the AI service";
  if (e instanceof Anthropic.APIError) return `The AI service returned an error (status ${e.status ?? "unknown"})`;
  return "The AI request failed";
}

export async function attribute(input: AttributeInput, opts: AttributeOptions = {}): Promise<AttributionResponse> {
  const client = opts.client ?? getDefaultClient();
  const messages: BetaMessageParam[] = [{ role: "user", content: buildUserMessage(input) }];
  let lastProblems: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: BetaMessage;
    try {
      res = await client.create(buildRequest(input, messages, opts.model));
    } catch (e) {
      throw new AttributionError("API_ERROR", describeApiError(e), [], { cause: e });
    }

    if (res.stop_reason === "refusal") throw new AttributionError("REFUSED", "The AI declined to process these notes");
    if (res.stop_reason === "max_tokens") throw new AttributionError("TRUNCATED", "The AI response was cut off");

    const result = readAttempt(res, input);
    if (result.ok) return result.value;
    lastProblems = result.problems;

    // Send the whole assistant turn back unchanged, then explain what was wrong.
    const feedback =
      `Your answer had these problems:\n${result.problems.map((p) => `- ${p}`).join("\n")}\n\n` +
      `Fix them and call ${ATTRIBUTION_TOOL_NAME} again with the complete corrected answer.`;
    const reply: BetaContentBlockParam[] = result.toolUseId
      ? [{ type: "tool_result", tool_use_id: result.toolUseId, is_error: true, content: feedback }]
      : [{ type: "text", text: feedback }];
    messages.push({ role: "assistant", content: res.content }, { role: "user", content: reply });
  }

  throw new AttributionError("INVALID_RESPONSE", "The AI response didn't pass validation after a retry", lastProblems);
}
