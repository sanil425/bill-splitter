/**
 * Upload limits and file type checks. Types come from the file's bytes, never
 * from the declared MIME type or name.
 */
import { parseBuffer } from "music-metadata";

const MB = 1024 * 1024;

/** Vercel caps request bodies at 4.5 MB, so both limits stay under that. */
export const MAX_IMAGE_BYTES = 4 * MB;
/** 3 minutes of voice at typical browser bitrates (~128 kbps) is about 3 MB. */
export const MAX_AUDIO_BYTES = 4 * MB;
export const MAX_AUDIO_SECONDS = 180;

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  return null;
}

export const AUDIO_FORMATS = {
  webm: { mimeType: "audio/webm", extension: "webm" },
  /** Also covers .m4a (same container). */
  mp4: { mimeType: "audio/mp4", extension: "mp4" },
  mpeg: { mimeType: "audio/mpeg", extension: "mp3" },
} as const;
export type AudioFormat = keyof typeof AUDIO_FORMATS;

export function sniffAudioType(bytes: Uint8Array): AudioFormat | null {
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "webm"; // EBML
  if (startsWith(bytes, ascii("ftyp"), 4)) return "mp4";
  if (startsWith(bytes, ascii("ID3"))) return "mpeg";
  // MPEG audio frame sync with a real layer (excludes AAC ADTS, whose layer bits are 00).
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0 && ((bytes[1] ?? 0) & 0x06) !== 0) return "mpeg";
  return null;
}

/**
 * Duration in seconds, or undefined if it can't be read. Scans the whole file
 * when the header has no duration (browser-recorded webm often doesn't).
 */
export async function audioDurationSeconds(bytes: Uint8Array, format: AudioFormat): Promise<number | undefined> {
  try {
    const meta = await parseBuffer(bytes, { mimeType: AUDIO_FORMATS[format].mimeType, size: bytes.length }, { duration: true, skipCovers: true });
    const d = meta.format.duration;
    return d !== undefined && Number.isFinite(d) ? d : undefined;
  } catch {
    return undefined;
  }
}
