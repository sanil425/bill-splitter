/**
 * Receipt reading: one vision call per photo. The model transcribes items and
 * printed amounts; it never computes a price. Same tool + Zod + one-retry
 * pattern as attribution.
 */
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { ReceiptParseResponseSchema, type ReceiptParseResponse } from "../schemas";
import type { ImageType } from "../uploads";
import { getMessagesClient, type MessagesClient } from "./client";
import { RECEIPT_MAX_TOKENS, receiptModel } from "./config";
import { loadPrompt } from "./prompts";
import { AiError, callTool, toolFromSchema, zodProblems } from "./tool-call";

export const RECEIPT_PROMPT = "receipt.v1";
export const RECEIPT_TOOL_NAME = "submit_receipt";

export class ReceiptParseError extends AiError {
  override readonly name = "ReceiptParseError";
}

export type ReceiptImage = { data: Uint8Array; mediaType: ImageType };

export type ParseReceiptOptions = {
  client?: MessagesClient;
  model?: string;
};

export const RECEIPT_TOOL = toolFromSchema(
  RECEIPT_TOOL_NAME,
  "Submit every item on the receipt with its printed line total, plus the printed subtotal, tax, tip, service charge and total. " +
    "Call this exactly once with your complete answer.",
  ReceiptParseResponseSchema,
);

export function buildReceiptRequest(model = receiptModel()): Omit<MessageCreateParamsNonStreaming, "messages"> {
  return {
    model,
    max_tokens: RECEIPT_MAX_TOKENS,
    system: [{ type: "text", text: loadPrompt(RECEIPT_PROMPT), cache_control: { type: "ephemeral" } }],
    tools: [RECEIPT_TOOL],
    // Forced tool_choice is rejected by current models; see attribute.ts.
    tool_choice: { type: "auto", disable_parallel_tool_use: true },
  };
}

export function parseReceipt(image: ReceiptImage, opts: ParseReceiptOptions = {}): Promise<ReceiptParseResponse> {
  return callTool({
    client: opts.client ?? getMessagesClient(),
    request: buildReceiptRequest(opts.model),
    userContent: [
      {
        type: "image",
        source: { type: "base64", media_type: image.mediaType, data: Buffer.from(image.data).toString("base64") },
      },
      { type: "text", text: `Read this receipt and call ${RECEIPT_TOOL_NAME} with what it says.` },
    ],
    toolName: RECEIPT_TOOL_NAME,
    check: (raw) => {
      const parsed = ReceiptParseResponseSchema.safeParse(raw);
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false, problems: zodProblems(parsed.error) };
    },
    ErrorClass: ReceiptParseError,
  });
}
