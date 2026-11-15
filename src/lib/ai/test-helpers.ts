/** Fakes for AI tests (no network). */
import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import type { MessagesClient, TranscriptionClient } from "./client";

let toolUseCounter = 0;

export function message(content: unknown[], stop_reason = "tool_use"): Message {
  return { id: "msg_1", type: "message", role: "assistant", model: "test", content, stop_reason } as unknown as Message;
}

export const toolCall = (name: string, input: unknown) =>
  message([
    { type: "text", text: "Here you go." },
    { type: "tool_use", id: `toolu_${++toolUseCounter}`, name, input },
  ]);

/** Returns the queued responses in order and records every request. */
export function fakeMessagesClient(...responses: (Message | Error)[]) {
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

export function fakeTranscriptionClient(result: string | Error) {
  const calls: { file: File; model: string }[] = [];
  const client: TranscriptionClient = {
    async transcribe(file, model) {
      calls.push({ file, model });
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { client, calls };
}
