"use client";

import { useEffect, useRef, useState } from "react";

export const MAX_RECORDING_SECONDS = 180;

/** Records one voice note at a time with MediaRecorder; stops itself at 3 minutes. */
export function useRecorder(onRecorded: (audio: Blob) => void) {
  const [seconds, setSeconds] = useState<number | null>(null); // null = not recording
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const done = useRef(onRecorded);
  useEffect(() => {
    done.current = onRecorded;
  });

  // Releases the mic if the page goes away mid-recording.
  useEffect(() => () => recorder.current?.stream.getTracks().forEach((t) => t.stop()), []);

  useEffect(() => {
    if (seconds === null) return;
    if (seconds >= MAX_RECORDING_SECONDS) {
      recorder.current?.stop();
      return;
    }
    const t = setTimeout(() => setSeconds(seconds + 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError(
        window.isSecureContext
          ? "This browser can't record voice notes. Type who had what instead."
          : "Voice notes need a secure (https) connection. Type who had what instead.",
      );
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      setError(
        denied
          ? "Microphone access is blocked. Allow it in your browser settings, or type instead."
          : "Couldn't start the microphone. Type who had what instead.",
      );
      return;
    }
    const rec = new MediaRecorder(stream); // the browser picks webm (Chrome) or mp4 (Safari); both are accepted
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      setSeconds(null);
      if (chunks.length) done.current(new Blob(chunks, { type: rec.mimeType }));
    };
    recorder.current = rec;
    rec.start();
    setSeconds(0);
  }

  const stop = () => recorder.current?.stop();

  return { recording: seconds !== null, seconds: seconds ?? 0, error, start, stop };
}
