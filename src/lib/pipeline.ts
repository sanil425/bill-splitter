/**
 * Runs the AI steps for a split: parse photos + transcribe pending voice (in
 * parallel), then attribution. Progress is saved on the split as it goes
 * (photo.receiptId, voice.transcript), so running it again resumes: parsed
 * photos are never re-parsed.
 */
import { ReceiptSchema, SplitSchema, type Split } from "@/lib/schemas";
import { mergeFlags, validate } from "@/lib/validator";

export type StepId = "receipts" | "voice" | "attribution";
export type StepState = { status: "todo" | "active" | "done" | "error"; error?: string };

export type PipelineDeps = {
  fetch: typeof fetch;
  /** Full-size photo / recorded audio by input id. Only held in memory. */
  blob: (inputId: string) => Blob | undefined;
  onStep: (step: StepId, state: StepState) => void;
  /** Called with every saved bit of progress, and with the finished split. */
  onSplit: (split: Split) => void;
  signal?: AbortSignal;
};

class StepError extends Error {}

const AttributionResultSchema = SplitSchema.pick({ people: true, assignments: true, rules: true, charges: true, flags: true });

const OFFLINE = "Couldn't reach SplitIt. Check your connection and try again.";

/** POSTs and returns the JSON body. Throws StepError with a message fit to show the user. */
async function post(deps: Pick<PipelineDeps, "fetch" | "signal">, url: string, body: BodyInit, fallback: string): Promise<unknown> {
  let res: Response;
  try {
    res = await deps.fetch(url, { method: "POST", body, signal: deps.signal });
  } catch (e) {
    if (deps.signal?.aborted) throw e;
    throw new StepError(OFFLINE);
  }
  if (res.ok) return res.json();
  const message = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message;
  // 4xx, 429 and 503 messages are written for people; 502/500 aren't.
  throw new StepError(message && (res.status < 500 || res.status === 503) ? message : fallback);
}

const form = (field: string, blob: Blob, filename: string) => {
  const data = new FormData();
  data.append(field, blob, filename);
  return data;
};

/** Stands in for a silent recording, so it doesn't look untranscribed forever. Never sent to the model. */
export const NOTHING_HEARD = "(nothing heard)";

export async function transcribeAudio(deps: Pick<PipelineDeps, "fetch" | "signal">, audio: Blob): Promise<string> {
  const res = await post(deps, "/api/transcribe", form("audio", audio, "voice"), "Couldn't transcribe this voice note.");
  const text = (res as { text?: unknown }).text;
  if (typeof text !== "string") throw new StepError("Couldn't transcribe this voice note.");
  return text.trim() || NOTHING_HEARD;
}

const messagesOf = (split: Split) =>
  split.inputs.flatMap((i) => (i.kind === "text" ? [i.text] : i.kind === "voice" ? [i.transcript] : [])).filter((m) => m.trim() && m !== NOTHING_HEARD);

export const hasPendingVoice = (split: Split) => split.inputs.some((i) => i.kind === "voice" && !i.transcript);

/** Returns the finished split, or null if a step failed (each failure is reported via onStep) or it was aborted. */
export async function runPipeline(start: Split, deps: PipelineDeps): Promise<Split | null> {
  let split = start;
  const live = () => !deps.signal?.aborted;
  const step = (id: StepId, state: StepState) => live() && deps.onStep(id, state);
  const save = (next: Split) => {
    split = next;
    if (live()) deps.onSplit(next);
  };
  const errorText = (e: unknown) => (e instanceof StepError ? e.message : "Something went wrong.");

  async function receipts(): Promise<boolean> {
    step("receipts", { status: "active" });
    const photos = split.inputs.filter((i) => i.kind === "photo");
    const todo = photos.filter((p) => !p.receiptId);
    const results = await Promise.allSettled(
      todo.map(async (photo) => {
        const blob = deps.blob(photo.id);
        if (!blob) throw new StepError("This photo was lost when the page reloaded. Delete it and add it again.");
        const body = await post(deps, "/api/parse-receipt", form("image", blob, "receipt.jpg"), "Couldn't read this receipt.");
        return ReceiptSchema.parse(body);
      }),
    );
    if (!live()) return false;

    const parsed = new Map(todo.flatMap((p, i) => (results[i].status === "fulfilled" ? [[p.id, results[i].value]] : [])));
    if (parsed.size) {
      const inputs = split.inputs.map((i) => (parsed.has(i.id) ? { ...i, receiptId: parsed.get(i.id)!.id } : i));
      save({ ...split, inputs, receipts: [...split.receipts, ...parsed.values()] });
    }

    const failures = results.flatMap((r, i) =>
      r.status === "rejected" ? [`Photo ${photos.indexOf(todo[i]) + 1}: ${errorText(r.reason)}`] : [],
    );
    if (failures.length) step("receipts", { status: "error", error: failures.join("\n") });
    else step("receipts", { status: "done" });
    return failures.length === 0;
  }

  async function voice(): Promise<boolean> {
    const pending = split.inputs.filter((i) => i.kind === "voice" && !i.transcript);
    if (!pending.length) return true;
    step("voice", { status: "active" });
    const results = await Promise.allSettled(
      pending.map((v) => {
        const blob = deps.blob(v.id);
        if (!blob) return Promise.reject(new StepError("A voice note was lost when the page reloaded. Delete it and record it again."));
        return transcribeAudio(deps, blob);
      }),
    );
    if (!live()) return false;

    const texts = new Map(pending.flatMap((v, i) => (results[i].status === "fulfilled" ? [[v.id, results[i].value]] : [])));
    const inputs = split.inputs.map((i) => (texts.has(i.id) ? { ...i, transcript: texts.get(i.id)! } : i));
    if (texts.size) save({ ...split, inputs });

    const failed = results.find((r) => r.status === "rejected");
    step("voice", failed ? { status: "error", error: errorText(failed.reason) } : { status: "done" });
    return !failed;
  }

  async function attribution(): Promise<boolean> {
    step("attribution", { status: "active" });
    const host = split.people.find((p) => p.id === split.hostId)!;
    const items = split.receipts.flatMap((r) => r.items);
    const messages = messagesOf(split);

    let result;
    if (messages.length === 0) {
      // No notes: the host had everything. No AI call needed.
      result = {
        people: [host],
        assignments: items.map((i) => ({ itemId: i.id, shares: { [host.id]: 1 } })),
        rules: [],
        charges: split.charges,
        flags: [],
      };
    } else {
      try {
        const body = await post(
          deps,
          "/api/attribute",
          JSON.stringify({ items, messages, hostName: host.name }),
          "Couldn't work out who had what.",
        );
        result = AttributionResultSchema.parse(body);
      } catch (e) {
        if (!live()) return false;
        step("attribution", { status: "error", error: errorText(e) });
        return false;
      }
    }
    if (!live()) return false;

    // The model returns the host (by name) exactly once; adopt its id.
    const hostId = result.people.find((p) => p.isHost)?.id ?? host.id;
    const next: Split = {
      ...split,
      hostId,
      people: result.people,
      assignments: result.assignments,
      rules: result.rules,
      charges: result.charges,
      // Old attribution flags go; confirmed validator flags keep their state by id.
      flags: [...split.flags.filter((f) => f.source !== "attribution"), ...result.flags],
    };
    save({ ...next, flags: mergeFlags(next.flags, validate(next)) });
    step("attribution", { status: "done" });
    return true;
  }

  try {
    const [photosOk, voiceOk] = await Promise.all([receipts(), voice()]);
    if (!photosOk || !voiceOk || !(await attribution())) return null;
    return split;
  } catch (e) {
    if (!live()) return null;
    throw e;
  }
}
