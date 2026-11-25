"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useSplit } from "@/components/split-store";
import { Button, CameraIcon, Card, IconButton, MicIcon, PlusIcon, SectionLabel, TopBar, TrashIcon, BottomBar } from "@/components/ui";
import { MAX_RECORDING_SECONDS, useRecorder } from "@/components/use-recorder";
import { shrinkImage } from "@/lib/image";
import { transcribeAudio } from "@/lib/pipeline";
import { blobs } from "@/lib/store/blobs";

const MAX_PHOTOS = 5;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function CapturePage() {
  const { split, dispatch } = useSplit();
  const router = useRouter();
  const [text, setText] = useState("");
  const [preparing, setPreparing] = useState(0);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Voice input id -> "busy" while transcribing, or the error message.
  const [voiceState, setVoiceState] = useState<Record<string, string>>({});
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);

  const photos = split.inputs.filter((i) => i.kind === "photo");
  const notes = split.inputs.filter((i) => i.kind !== "photo");
  const full = photos.length + preparing >= MAX_PHOTOS;
  const transcribing = Object.values(voiceState).includes("busy");

  async function transcribe(id: string) {
    const audio = blobs.get(id);
    if (!audio) return;
    setVoiceState((s) => ({ ...s, [id]: "busy" }));
    try {
      const transcript = await transcribeAudio({ fetch }, audio);
      dispatch({ type: "editInput", id, text: transcript });
      setVoiceState(({ [id]: _, ...rest }) => rest);
    } catch (e) {
      setVoiceState((s) => ({ ...s, [id]: e instanceof Error ? e.message : "Couldn't transcribe this voice note." }));
    }
  }

  const recorder = useRecorder((audio) => {
    const id = crypto.randomUUID();
    blobs.set(id, audio);
    dispatch({ type: "addInput", input: { id, kind: "voice", transcript: "" } });
    transcribe(id);
  });

  async function addPhotos(input: HTMLInputElement) {
    const files = Array.from(input.files ?? []).slice(0, MAX_PHOTOS - photos.length - preparing);
    input.value = ""; // so picking the same file again still fires onChange
    setPhotoError(null);
    setPreparing((n) => n + files.length);
    for (const file of files) {
      try {
        const { blob, thumbnail } = await shrinkImage(file);
        const id = crypto.randomUUID();
        blobs.set(id, blob);
        dispatch({ type: "addInput", input: { id, kind: "photo", thumbnail } });
      } catch {
        setPhotoError("Couldn't open that photo. Try another one, or take a new picture.");
      } finally {
        setPreparing((n) => n - 1);
      }
    }
  }

  function process() {
    if (
      split.assignments.length > 0 &&
      !confirm("This redoes who-had-what; your manual assignments will be replaced.")
    ) {
      return;
    }
    router.push(`/split/${split.id}/processing`);
  }

  const busy = preparing > 0 || transcribing || recorder.recording;

  return (
    <>
      <TopBar title="New split" subtitle="Step 1 of 3 · Add" backHref="/" />
      <main className="flex flex-1 flex-col gap-5.5 px-5 py-4">
        <section className="flex flex-col gap-2.5">
          <SectionLabel>Receipts</SectionLabel>
          <div className="flex gap-2.5 overflow-x-auto pt-1">
            {photos.map((p, i) => (
              <div key={p.id} className="relative h-32 w-24 flex-none overflow-hidden rounded-ib border border-stone-300 bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                {p.thumbnail && <img src={p.thumbnail} alt={`Receipt ${i + 1}`} className="size-full object-cover" />}
                <IconButton
                  aria-label={`Delete receipt ${i + 1}`}
                  className="absolute top-0 right-0 text-white drop-shadow-[0_0_3px_rgba(0,0,0,0.8)]"
                  onClick={() => {
                    if (p.receiptId && !confirm("Delete this receipt and its items?")) return;
                    blobs.delete(p.id);
                    dispatch({ type: "removeInput", id: p.id });
                  }}
                >
                  <TrashIcon />
                </IconButton>
              </div>
            ))}
            {Array.from({ length: preparing }, (_, i) => (
              <div
                key={`preparing-${i}`}
                className="flex h-32 w-24 flex-none items-center justify-center rounded-ib border border-stone-300 text-xs text-muted"
              >
                Preparing…
              </div>
            ))}
            {!full && (
              <button
                type="button"
                onClick={() => library.current?.click()}
                className="flex h-32 w-24 flex-none flex-col items-center justify-center gap-1.5 rounded-ib border-[1.5px] border-dashed border-stone-400 text-[13px] font-medium text-stone-700"
              >
                <PlusIcon />
                Add photo
              </button>
            )}
          </div>
          {full && <p className="text-[13px] text-muted">Up to {MAX_PHOTOS} photos per split.</p>}
          {photoError && <p role="alert" className="text-sm text-fix">{photoError}</p>}
          <input ref={library} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target)} />
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => addPhotos(e.target)} />
        </section>

        <section className="flex flex-col gap-2.5">
          <SectionLabel>Who had what</SectionLabel>
          {notes.length === 0 && (
            <p className="text-sm text-muted">Record a voice note or type who had what. Skip it if you paid for everything yourself.</p>
          )}
          {notes.map((input) => {
            const content = input.kind === "voice" ? input.transcript : input.kind === "text" ? input.text : "";
            const state = voiceState[input.id];
            return (
              <Card key={input.id} className="flex items-start gap-3 p-3.5">
                <div className="flex flex-1 flex-col gap-1 py-1">
                  {input.kind === "voice" && <span className="text-xs font-semibold text-muted">Voice note</span>}
                  {content ? (
                    <>
                      <label htmlFor={`note-${input.id}`} className="sr-only">
                        Edit note
                      </label>
                      <textarea
                        id={`note-${input.id}`}
                        key={content}
                        defaultValue={content}
                        onBlur={(e) => dispatch({ type: "editInput", id: input.id, text: e.target.value })}
                        className="field-sizing-content min-h-11 resize-none rounded-ib border border-transparent px-1 py-1.5 text-[15px] leading-snug focus:border-stone-300"
                      />
                    </>
                  ) : state === "busy" ? (
                    <p className="py-1.5 text-[15px] text-muted">Transcribing…</p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 py-1.5">
                      <p className="text-sm text-fix">{state ?? "Not transcribed yet. Process will try again."}</p>
                      {blobs.has(input.id) && (
                        <Button size="sm" variant="secondary" onClick={() => transcribe(input.id)}>
                          Retry
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <IconButton
                  aria-label={input.kind === "voice" ? "Delete voice note" : "Delete note"}
                  className="text-muted"
                  onClick={() => {
                    blobs.delete(input.id);
                    dispatch({ type: "removeInput", id: input.id });
                  }}
                >
                  <TrashIcon />
                </IconButton>
              </Card>
            );
          })}
        </section>
      </main>

      <BottomBar className="flex flex-col gap-3">
        {recorder.error && <p role="alert" className="text-sm text-fix">{recorder.error}</p>}
        {recorder.recording ? (
          <div className="flex items-center gap-3">
            <span className="size-3 flex-none animate-pulse rounded-full bg-fix" aria-hidden="true" />
            <span className="flex-1 text-[15px] font-semibold" role="timer" aria-live="off">
              Recording {clock(recorder.seconds)} / {clock(MAX_RECORDING_SECONDS)}
            </span>
            <Button size="sm" variant="dark" onClick={recorder.stop}>
              Stop
            </Button>
          </div>
        ) : (
          <form
            className="flex items-center gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              dispatch({ type: "addInput", input: { id: crypto.randomUUID(), kind: "text", text: text.trim() } });
              setText("");
            }}
          >
            <label htmlFor="msg" className="sr-only">
              Message
            </label>
            <input
              id="msg"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type who had what…"
              enterKeyHint="send"
              className="h-12 min-w-0 flex-1 rounded-btn border border-stone-300 bg-bg px-3.5 text-[15px]"
            />
            <IconButton
              aria-label="Take receipt photo"
              disabled={full}
              onClick={() => camera.current?.click()}
              className="size-12 rounded-ib border border-line bg-white disabled:text-stone-300"
            >
              <CameraIcon />
            </IconButton>
            <IconButton
              aria-label="Record voice note"
              onClick={recorder.start}
              className="size-12 rounded-full bg-primary text-white hover:bg-primary-hover"
            >
              <MicIcon />
            </IconButton>
          </form>
        )}
        {photos.length === 0 && <p className="text-center text-[13px] text-muted">Add a receipt photo to continue</p>}
        <Button disabled={photos.length === 0 || busy} onClick={process}>
          Process
        </Button>
      </BottomBar>
    </>
  );
}
