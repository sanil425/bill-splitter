import { AttributionError, attribute } from "@/lib/ai/attribute";
import { AttributeRequestSchema, attributionFromAi } from "@/lib/schemas";

// Up to two model calls (validation retry), each with its own timeout.
export const maxDuration = 120;

const error = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error: { code, message, ...extra } }, { status });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, "BAD_REQUEST", "Body must be JSON");
  }

  const parsed = AttributeRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return error(400, "BAD_REQUEST", "Invalid request body", { issues });
  }

  try {
    const ai = await attribute(parsed.data);
    const { people, assignments, rules, charges, flags } = attributionFromAi(ai);
    return Response.json({ people, assignments, rules, charges, flags });
  } catch (e) {
    if (e instanceof AttributionError) {
      console.error(`[attribute] ${e.code}: ${e.message}`, e.issues);
      return error(502, e.code, e.message);
    }
    console.error("[attribute] unexpected error", e instanceof Error ? e.message : e);
    return error(500, "INTERNAL", "Something went wrong");
  }
}
