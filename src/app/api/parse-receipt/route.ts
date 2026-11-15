import { parseReceipt } from "@/lib/ai/receipt";
import { aiFailureResponse, errorResponse, readUpload } from "@/lib/http";
import { checkRateLimit } from "@/lib/ratelimit";
import { receiptFromAi } from "@/lib/schemas";
import { MAX_IMAGE_BYTES, sniffImageType } from "@/lib/uploads";

// Up to two vision calls (validation retry), each with its own timeout.
export const maxDuration = 150;

/** multipart/form-data with one `image` file (JPEG, PNG or WebP, max 4 MB). Returns a domain Receipt. */
export async function POST(request: Request) {
  const upload = await readUpload(request, "image", MAX_IMAGE_BYTES, "Photos can be up to 4 MB");
  if (!upload.ok) return upload.response;

  const mediaType = sniffImageType(upload.bytes);
  if (!mediaType) return errorResponse(400, "UNSUPPORTED_TYPE", "Photos must be JPEG, PNG or WebP");

  const limited = await checkRateLimit(request);
  if (limited) return limited;

  try {
    const receipt = receiptFromAi(await parseReceipt({ data: upload.bytes, mediaType }));
    if (receipt.items.length === 0) {
      return errorResponse(422, "NO_ITEMS", "Couldn't find any items on this photo. Try a clearer photo of the receipt.");
    }
    return Response.json(receipt);
  } catch (e) {
    return aiFailureResponse("parse-receipt", e);
  }
}
