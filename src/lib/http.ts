/** Small helpers shared by the API routes. */
import { AiError } from "./ai/tool-call";

export function errorResponse(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
  headers?: HeadersInit,
): Response {
  return Response.json({ error: { code, message, ...extra } }, { status, headers });
}

/** Maps an AI failure to 502 (with the code, never internals) and anything else to 500. */
export function aiFailureResponse(route: string, e: unknown): Response {
  if (e instanceof AiError) {
    console.error(`[${route}] ${e.code}: ${e.message}`, e.issues);
    return errorResponse(502, e.code, e.message);
  }
  console.error(`[${route}] unexpected error`, e instanceof Error ? e.message : e);
  return errorResponse(500, "INTERNAL", "Something went wrong");
}

type Upload = { ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false; response: Response };

/** Reads exactly one file from a multipart form field, enforcing a size cap. */
export async function readUpload(request: Request, field: string, maxBytes: number, tooLargeMessage: string): Promise<Upload> {
  const fail = (status: number, code: string, message: string): Upload => ({ ok: false, response: errorResponse(status, code, message) });

  // Reject obviously oversized bodies before reading them (allowing for multipart overhead).
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBytes + 64 * 1024) return fail(413, "TOO_LARGE", tooLargeMessage);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "BAD_REQUEST", `Send the file as multipart/form-data in a "${field}" field`);
  }
  const files = form.getAll(field);
  if (files.length !== 1 || !(files[0] instanceof File)) {
    return fail(400, "BAD_REQUEST", `Send exactly one file in the "${field}" field`);
  }
  const file = files[0];
  if (file.size === 0) return fail(400, "BAD_REQUEST", "The file is empty");
  if (file.size > maxBytes) return fail(413, "TOO_LARGE", tooLargeMessage);
  return { ok: true, bytes: new Uint8Array(await file.arrayBuffer()) };
}
