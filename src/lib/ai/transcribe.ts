/** Voice note -> text via OpenAI transcription. */
import { AUDIO_FORMATS, type AudioFormat } from "../uploads";
import { describeApiError, getTranscriptionClient, type TranscriptionClient } from "./client";
import { transcribeModel } from "./config";
import { AiError } from "./tool-call";

/** Always code API_ERROR. */
export class TranscriptionError extends AiError {
  override readonly name = "TranscriptionError";
}

export type VoiceNote = { data: Uint8Array<ArrayBuffer>; format: AudioFormat };

export type TranscribeOptions = {
  client?: TranscriptionClient;
  model?: string;
};

export async function transcribe(audio: VoiceNote, opts: TranscribeOptions = {}): Promise<string> {
  const { extension, mimeType } = AUDIO_FORMATS[audio.format];
  // OpenAI detects the format from the file name.
  const file = new File([audio.data], `voice-note.${extension}`, { type: mimeType });
  try {
    const client = opts.client ?? getTranscriptionClient();
    return (await client.transcribe(file, opts.model ?? transcribeModel())).trim();
  } catch (e) {
    throw new TranscriptionError("API_ERROR", describeApiError(e), [], { cause: e });
  }
}
