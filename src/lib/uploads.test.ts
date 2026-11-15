import { describe, expect, it } from "vitest";
import { audioDurationSeconds, sniffAudioType, sniffImageType } from "./uploads";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)).concat(new Array(16).fill(0)));

describe("sniffImageType", () => {
  it("recognises JPEG, PNG and WebP by their bytes", () => {
    expect(sniffImageType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImageType(bytes("RIFF", [1, 2, 3, 4], "WEBP"))).toBe("image/webp");
  });

  it("rejects anything else (GIF, HEIC, text, empty)", () => {
    expect(sniffImageType(bytes("GIF89a"))).toBeNull();
    expect(sniffImageType(bytes([0, 0, 0, 0x18], "ftypheic"))).toBeNull();
    expect(sniffImageType(bytes("hello"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("sniffAudioType", () => {
  it("recognises webm, mp4/m4a and mp3", () => {
    expect(sniffAudioType(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBe("webm");
    expect(sniffAudioType(bytes([0, 0, 0, 0x20], "ftypM4A "))).toBe("mp4");
    expect(sniffAudioType(bytes([0, 0, 0, 0x1c], "ftypisom"))).toBe("mp4");
    expect(sniffAudioType(bytes("ID3", [4, 0]))).toBe("mpeg");
    expect(sniffAudioType(bytes([0xff, 0xfb, 0x90]))).toBe("mpeg");
  });

  it("rejects other formats", () => {
    expect(sniffAudioType(bytes("RIFF", [0, 0, 0, 0], "WAVE"))).toBeNull();
    expect(sniffAudioType(bytes("OggS"))).toBeNull();
    expect(sniffAudioType(bytes([0xff, 0xf1]))).toBeNull(); // AAC ADTS
    expect(sniffAudioType(bytes([0xff, 0xd8, 0xff]))).toBeNull(); // JPEG
  });
});

describe("audioDurationSeconds", () => {
  it("returns undefined for unparseable audio instead of throwing", async () => {
    expect(await audioDurationSeconds(bytes([0x1a, 0x45, 0xdf, 0xa3], "garbage"), "webm")).toBeUndefined();
  });
});
