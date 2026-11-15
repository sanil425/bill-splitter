import { beforeEach, describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
import { fakeTranscriptionClient } from "@/lib/ai/test-helpers";
import type { Limiters } from "@/lib/ratelimit";
import { deny, fakeLimiters } from "@/lib/ratelimit/test-helpers";
import { MAX_AUDIO_BYTES } from "@/lib/uploads";

// Fake transcription client, rate limiters and audio duration; everything else is real.
const fakes = vi.hoisted(() => ({
  client: undefined as unknown,
  limiters: null as Limiters | null,
  duration: 30 as number | undefined,
}));
vi.mock("@/lib/ai/client", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/ai/client")>()),
  getTranscriptionClient: () => fakes.client,
}));
vi.mock("@/lib/ratelimit/limiters", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/ratelimit/limiters")>()),
  getLimiters: () => fakes.limiters,
}));
vi.mock("music-metadata", () => ({
  parseBuffer: async () => ({ format: { duration: fakes.duration } }),
}));

const { POST } = await import("./route");

const webm = (size = 2000) => {
  const b = new Uint8Array(size);
  b.set([0x1a, 0x45, 0xdf, 0xa3]);
  return b;
};

function post(file?: Uint8Array | string, field = "audio") {
  const form = new FormData();
  if (file !== undefined) form.append(field, typeof file === "string" ? file : new File([file as Uint8Array<ArrayBuffer>], "note.webm"));
  return POST(new Request("http://localhost/api/transcribe", { method: "POST", body: form }));
}

const errorCode = async (res: Response) => (await res.json()).error.code;

beforeEach(() => {
  fakes.limiters = fakeLimiters().limiters;
  fakes.client = fakeTranscriptionClient("unused").client;
  fakes.duration = 30;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/transcribe", () => {
  it("returns { text } from the transcription", async () => {
    const fake = fakeTranscriptionClient(" Josh had the burger and I had the salad. ");
    fakes.client = fake.client;
    const res = await post(webm());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "Josh had the burger and I had the salad." });
    expect(fake.calls[0].file.name).toBe("voice-note.webm");
  });

  it("accepts mp4/m4a and mp3, and audio whose duration can't be read", async () => {
    const fake = fakeTranscriptionClient("ok");
    fakes.client = fake.client;
    const m4a = new Uint8Array(100);
    m4a.set([0, 0, 0, 0x20, ...new TextEncoder().encode("ftypM4A ")]);
    const mp3 = new Uint8Array(100);
    mp3.set(new TextEncoder().encode("ID3"));
    expect((await post(m4a)).status).toBe(200);
    expect((await post(mp3)).status).toBe(200);
    fakes.duration = undefined;
    expect((await post(webm())).status).toBe(200);
    expect(fake.calls.map((c) => c.file.name)).toEqual(["voice-note.mp4", "voice-note.mp3", "voice-note.webm"]);
  });

  it("rejects bad input with 400 before calling OpenAI or the rate limiter", async () => {
    const { limiters, ids } = fakeLimiters();
    fakes.limiters = limiters;
    const fake = fakeTranscriptionClient("nope");
    fakes.client = fake.client;

    expect(await errorCode(await post())).toBe("BAD_REQUEST");
    expect(await errorCode(await post("hello"))).toBe("BAD_REQUEST");
    expect(await errorCode(await post(webm(), "file"))).toBe("BAD_REQUEST");
    expect(await errorCode(await post(new TextEncoder().encode("RIFF....WAVEfmt ")))).toBe("UNSUPPORTED_TYPE");
    expect(await errorCode(await post(new TextEncoder().encode("OggS............")))).toBe("UNSUPPORTED_TYPE");

    expect(fake.calls).toHaveLength(0);
    expect(ids.perIp).toHaveLength(0);
  });

  it("returns 413 for audio over the size cap or longer than 3 minutes", async () => {
    let res = await post(webm(MAX_AUDIO_BYTES + 1));
    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe("TOO_LARGE");

    fakes.duration = 181.5;
    res = await post(webm());
    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe("TOO_LONG");

    fakes.duration = 180.4; // within a second of the limit is fine
    expect((await post(webm())).status).toBe(200);
  });

  it("returns 429 when rate limited, without calling OpenAI", async () => {
    const fake = fakeTranscriptionClient("hi");
    fakes.client = fake.client;
    fakes.limiters = fakeLimiters(undefined, deny()).limiters;
    const res = await post(webm());
    expect(res.status).toBe(429);
    expect(await errorCode(res)).toBe("DAILY_LIMIT");
    expect(fake.calls).toHaveLength(0);
  });

  it("returns 502 without internals when OpenAI fails", async () => {
    fakes.client = fakeTranscriptionClient(new OpenAI.APIConnectionError({ message: "secret upstream detail" })).client;
    const res = await post(webm());
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe("API_ERROR");
    expect(text).not.toContain("secret");
  });
});
