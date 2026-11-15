import { transcribe } from "@/lib/ai/transcribe";
import { aiFailureResponse, errorResponse, readUpload } from "@/lib/http";
import { checkRateLimit } from "@/lib/ratelimit";
import { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, audioDurationSeconds, sniffAudioType } from "@/lib/uploads";

export const maxDuration = 150;

const TOO_LONG = "Voice notes can be up to 3 minutes";

/** multipart/form-data with one `audio` file (webm, mp4/m4a or mp3; max 3 minutes). Returns { text }. */
export async function POST(request: Request) {
  const upload = await readUpload(request, "audio", MAX_AUDIO_BYTES, TOO_LONG);
  if (!upload.ok) return upload.response;

  const format = sniffAudioType(upload.bytes);
  if (!format) return errorResponse(400, "UNSUPPORTED_TYPE", "Voice notes must be webm, mp4, m4a or mp3");

  // If the duration can't be read, the size cap is the limit.
  const seconds = await audioDurationSeconds(upload.bytes, format);
  if (seconds !== undefined && seconds > MAX_AUDIO_SECONDS + 1) return errorResponse(413, "TOO_LONG", TOO_LONG);

  const limited = await checkRateLimit(request);
  if (limited) return limited;

  try {
    const text = await transcribe({ data: upload.bytes, format });
    return Response.json({ text });
  } catch (e) {
    return aiFailureResponse("transcribe", e);
  }
}
