import { attribute } from "@/lib/ai/attribute";
import { aiFailureResponse, errorResponse } from "@/lib/http";
import { checkRateLimit } from "@/lib/ratelimit";
import { AttributeRequestSchema, attributionFromAi } from "@/lib/schemas";

// Up to two model calls (validation retry), each with its own timeout.
export const maxDuration = 150;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Body must be JSON");
  }

  const parsed = AttributeRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return errorResponse(400, "BAD_REQUEST", "Invalid request body", { issues });
  }

  // After validation, so malformed requests don't use up anyone's quota.
  const limited = await checkRateLimit(request);
  if (limited) return limited;

  try {
    const ai = await attribute(parsed.data);
    const { people, assignments, rules, charges, flags } = attributionFromAi(ai);
    return Response.json({ people, assignments, rules, charges, flags });
  } catch (e) {
    return aiFailureResponse("attribute", e);
  }
}
