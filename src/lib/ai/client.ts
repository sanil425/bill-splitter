/**
 * SDK clients for AI calls, server-side only. Each is wrapped in the one
 * method we use so tests can inject a fake. API keys are read by the SDKs
 * from ANTHROPIC_API_KEY / OPENAI_API_KEY; we never touch or log them.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import OpenAI from "openai";
import { REQUEST_TIMEOUT_MS, SDK_MAX_RETRIES } from "./config";

export type MessagesClient = {
  create(params: MessageCreateParamsNonStreaming): Promise<Message>;
};

export type TranscriptionClient = {
  /** Returns the transcript text. */
  transcribe(file: File, model: string): Promise<string>;
};

let messagesClient: MessagesClient | undefined;
export function getMessagesClient(): MessagesClient {
  if (!messagesClient) {
    const anthropic = new Anthropic({ timeout: REQUEST_TIMEOUT_MS, maxRetries: SDK_MAX_RETRIES });
    messagesClient = { create: (params) => anthropic.messages.create(params) };
  }
  return messagesClient;
}

let transcriptionClient: TranscriptionClient | undefined;
export function getTranscriptionClient(): TranscriptionClient {
  if (!transcriptionClient) {
    const openai = new OpenAI({ timeout: REQUEST_TIMEOUT_MS, maxRetries: SDK_MAX_RETRIES });
    transcriptionClient = {
      async transcribe(file, model) {
        const res = await openai.audio.transcriptions.create({ file, model });
        return res.text;
      },
    };
  }
  return transcriptionClient;
}

/** A user-safe description of an SDK failure (no internals). */
export function describeApiError(e: unknown): string {
  if (e instanceof Anthropic.APIConnectionTimeoutError || e instanceof OpenAI.APIConnectionTimeoutError) {
    return "The AI request timed out";
  }
  if (e instanceof Anthropic.APIConnectionError || e instanceof OpenAI.APIConnectionError) {
    return "Couldn't reach the AI service";
  }
  if (e instanceof Anthropic.APIError || e instanceof OpenAI.APIError) {
    return `The AI service returned an error (status ${e.status ?? "unknown"})`;
  }
  return "The AI request failed";
}
