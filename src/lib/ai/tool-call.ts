/**
 * The shared pattern for structured model calls: one tool, the answer checked
 * with Zod (plus any checks against what we sent), and on failure one retry
 * with the problems sent back to the model.
 */
import type {
  ContentBlockParam,
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import { describeApiError, type MessagesClient } from "./client";

const MAX_ATTEMPTS = 2;

export type AiErrorCode =
  /** Network error, timeout, or an error status from the API. */
  | "API_ERROR"
  /** The model declined the request. */
  | "REFUSED"
  /** The response hit max_tokens before finishing. */
  | "TRUNCATED"
  /** The model's answer failed validation twice. */
  | "INVALID_RESPONSE";

export class AiError extends Error {
  override readonly name: string = "AiError";
  constructor(
    readonly code: AiErrorCode,
    message: string,
    /** Validation problems from the last attempt (INVALID_RESPONSE only). */
    readonly issues: string[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export type AiErrorClass = new (...args: ConstructorParameters<typeof AiError>) => AiError;

export type Checked<T> = { ok: true; value: T } | { ok: false; problems: string[] };

export const zodProblems = (error: z.ZodError): string[] =>
  error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);

/** A tool whose input schema is generated from a Zod schema, so the two can't drift. */
export function toolFromSchema(name: string, description: string, schema: z.ZodType): Tool {
  // "input" mode: fields with defaults are optional for the model.
  const { $schema: _, ...inputSchema } = z.toJSONSchema(schema, { io: "input" });
  return { name, description, input_schema: inputSchema as Tool["input_schema"] };
}

export type ToolCallSpec<T> = {
  client: MessagesClient;
  /** Model, system prompt, tools etc.; the messages are added here. */
  request: Omit<MessageCreateParamsNonStreaming, "messages">;
  userContent: MessageParam["content"];
  toolName: string;
  /** Validates the tool input. */
  check: (input: unknown) => Checked<T>;
  /** Thrown for every failure. */
  ErrorClass: AiErrorClass;
};

export async function callTool<T>({ client, request, userContent, toolName, check, ErrorClass }: ToolCallSpec<T>): Promise<T> {
  const messages: MessageParam[] = [{ role: "user", content: userContent }];
  let lastProblems: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Message;
    try {
      res = await client.create({ ...request, messages: [...messages] });
    } catch (e) {
      throw new ErrorClass("API_ERROR", describeApiError(e), [], { cause: e });
    }

    if (res.stop_reason === "refusal") throw new ErrorClass("REFUSED", "The AI declined this request");
    if (res.stop_reason === "max_tokens") throw new ErrorClass("TRUNCATED", "The AI response was cut off");

    const toolUse = res.content.find((b) => b.type === "tool_use" && b.name === toolName);
    let toolUseId: string | undefined;
    if (!toolUse || toolUse.type !== "tool_use") {
      lastProblems = [`You didn't call ${toolName}. Call it now with your complete answer.`];
    } else {
      const result = check(toolUse.input);
      if (result.ok) return result.value;
      lastProblems = result.problems;
      toolUseId = toolUse.id;
    }

    // Send the whole assistant turn back unchanged, then explain what was wrong.
    const feedback =
      `Your answer had these problems:\n${lastProblems.map((p) => `- ${p}`).join("\n")}\n\n` +
      `Fix them and call ${toolName} again with the complete corrected answer.`;
    const reply: ContentBlockParam[] = toolUseId
      ? [{ type: "tool_result", tool_use_id: toolUseId, is_error: true, content: feedback }]
      : [{ type: "text", text: feedback }];
    messages.push({ role: "assistant", content: res.content }, { role: "user", content: reply });
  }

  throw new ErrorClass("INVALID_RESPONSE", "The AI response didn't pass validation after a retry", lastProblems);
}
