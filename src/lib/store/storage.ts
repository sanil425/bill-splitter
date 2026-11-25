import { SplitSchema, type Split } from "@/lib/schemas";

const SPLIT_PREFIX = "splitit:split:";
const NAME_KEY = "splitit:name";

/** Saved data can be stale or hand-edited, so anything that fails the schema is ignored. */
export function loadSplit(id: string, storage: Storage = localStorage): Split | null {
  const raw = storage.getItem(SPLIT_PREFIX + id);
  if (!raw) return null;
  try {
    const parsed = SplitSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveSplit(split: Split, storage: Storage = localStorage): void {
  storage.setItem(SPLIT_PREFIX + split.id, JSON.stringify(split));
}

/** Every valid saved split, newest first. */
export function listSplits(storage: Storage = localStorage): Split[] {
  const splits: Split[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(SPLIT_PREFIX)) continue;
    const split = loadSplit(key.slice(SPLIT_PREFIX.length), storage);
    if (split) splits.push(split);
  }
  return splits.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function loadName(storage: Storage = localStorage): string | null {
  return storage.getItem(NAME_KEY);
}

export function saveName(name: string, storage: Storage = localStorage): void {
  storage.setItem(NAME_KEY, name);
}
