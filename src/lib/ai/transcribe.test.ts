import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { DEFAULT_TRANSCRIBE_MODEL } from "./config";
import { fakeTranscriptionClient } from "./test-helpers";
import { TranscriptionError, transcribe } from "./transcribe";

const audio = { data: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2]), format: "webm" as const };

describe("transcribe()", () => {
  it("sends a named file with the right type to the configured model and trims the text", async () => {
    const { client, calls } = fakeTranscriptionClient("  I had the salad.\n");
    expect(await transcribe(audio, { client })).toBe("I had the salad.");
    expect(calls[0].model).toBe(process.env.TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL);
    expect(calls[0].file.name).toBe("voice-note.webm");
    expect(calls[0].file.type).toBe("audio/webm");
    expect(calls[0].file.size).toBe(audio.data.length);
  });

  it("names mp4 and mp3 files so OpenAI can detect the format", async () => {
    const { client, calls } = fakeTranscriptionClient("ok");
    await transcribe({ ...audio, format: "mp4" }, { client, model: "gpt-test" });
    await transcribe({ ...audio, format: "mpeg" }, { client });
    expect(calls.map((c) => c.file.name)).toEqual(["voice-note.mp4", "voice-note.mp3"]);
    expect(calls[0].model).toBe("gpt-test");
  });

  it("wraps failures in TranscriptionError(API_ERROR) without internals", async () => {
    const { client } = fakeTranscriptionClient(new OpenAI.APIConnectionTimeoutError());
    const err = await transcribe(audio, { client }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscriptionError);
    expect((err as TranscriptionError).code).toBe("API_ERROR");
    expect((err as TranscriptionError).message).toBe("The AI request timed out");
  });
});
