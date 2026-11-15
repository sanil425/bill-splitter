/**
 * Settings for AI calls. Server-side only: nothing here may reach the client.
 * The API key is read by the Anthropic SDK from ANTHROPIC_API_KEY; we never
 * touch or log it ourselves.
 */

export const DEFAULT_ATTRIBUTION_MODEL = "claude-sonnet-5-5";

export function attributionModel(): string {
  return process.env.ATTRIBUTION_MODEL?.trim() || DEFAULT_ATTRIBUTION_MODEL;
}

/** Plenty for a structured attribution plus thinking; non-streaming stays under HTTP timeouts. */
export const ATTRIBUTION_MAX_TOKENS = 16_000;

/** Per-request timeout. */
export const REQUEST_TIMEOUT_MS = 45_000;

/** SDK-level retries for network errors, 429 and 5xx (separate from our validation retry). */
export const SDK_MAX_RETRIES = 1;

/**
 * If the model declines for policy reasons, the API re-runs the request on the
 * server's default fallback model instead of failing.
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
