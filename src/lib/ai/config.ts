/**
 * Settings for AI calls. Server-side only: nothing here may reach the client.
 * API keys are read by the SDKs from the environment; we never touch or log them.
 */

const fromEnv = (name: string, fallback: string) => process.env[name]?.trim() || fallback;

export const DEFAULT_ATTRIBUTION_MODEL = "claude-sonnet-5-5";
export const attributionModel = () => fromEnv("ATTRIBUTION_MODEL", DEFAULT_ATTRIBUTION_MODEL);

export const DEFAULT_RECEIPT_MODEL = "claude-sonnet-5-5";
export const receiptModel = () => fromEnv("RECEIPT_MODEL", DEFAULT_RECEIPT_MODEL);

/** OpenAI's current recommended file transcription model. */
export const DEFAULT_TRANSCRIBE_MODEL = "gpt-transcribe";
export const transcribeModel = () => fromEnv("TRANSCRIBE_MODEL", DEFAULT_TRANSCRIBE_MODEL);

/** Plenty for a structured answer plus thinking; non-streaming stays under HTTP timeouts. */
export const ATTRIBUTION_MAX_TOKENS = 16_000;
export const RECEIPT_MAX_TOKENS = 16_000;

/** Per-request timeout (vision with thinking on a long receipt can take a while). */
export const REQUEST_TIMEOUT_MS = 60_000;

/** SDK-level retries for network errors, 429 and 5xx (separate from our validation retry). */
export const SDK_MAX_RETRIES = 1;
