/**
 * Full-size photos and voice recordings by input id, waiting to be uploaded.
 * shortcut: memory only (too big for localStorage), so a reload before Process loses them
 * and the pipeline asks to re-add; move to IndexedDB if that bites.
 */
export const blobs = new Map<string, Blob>();
