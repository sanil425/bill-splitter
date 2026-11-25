/** Shrinks receipt photos on the phone so uploads stay under the server's 4 MB limit. */

export const MAX_EDGE = 2000;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // same as MAX_IMAGE_BYTES in uploads.ts (server-only)
const THUMB_EDGE = 240;
// Tried in order until the JPEG fits.
const ATTEMPTS = [
  { edge: MAX_EDGE, quality: 0.85 },
  { edge: MAX_EDGE, quality: 0.7 },
  { edge: 1600, quality: 0.7 },
  { edge: 1200, quality: 0.6 },
];

/** Scales width × height down (never up) so the long edge is at most maxEdge, keeping the aspect ratio. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function draw(bitmap: ImageBitmap, maxEdge: number): HTMLCanvasElement {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

const toJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

/** Photo → JPEG under 4 MB (long edge ≤ 2000px) plus a small thumbnail data URL. Throws if it can't. */
export async function shrinkImage(file: Blob): Promise<{ blob: Blob; thumbnail: string }> {
  const bitmap = await createImageBitmap(file); // applies EXIF rotation
  try {
    const thumbnail = draw(bitmap, THUMB_EDGE).toDataURL("image/jpeg", 0.6);
    for (const { edge, quality } of ATTEMPTS) {
      const blob = await toJpeg(draw(bitmap, edge), quality);
      if (blob && blob.size <= MAX_UPLOAD_BYTES) return { blob, thumbnail };
    }
    throw new Error("Photo is too large even after shrinking");
  } finally {
    bitmap.close();
  }
}
