import { describe, expect, it } from "vitest";
import { splitReducer } from "./reducer";
import { newSplit } from "./splits";
import { listSplits, loadName, loadSplit, saveName, saveSplit } from "./storage";

/** Minimal in-memory Storage (vitest runs in node, no localStorage). */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}

describe("autosave storage", () => {
  it("round-trips a split after edits", () => {
    const storage = memoryStorage();
    const split = splitReducer(newSplit("a", "Sanil"), { type: "addPerson", id: "p2", name: "Ali" });
    saveSplit(split, storage);
    expect(loadSplit("a", storage)).toEqual(split);
  });

  it("returns null for missing, corrupt or invalid data", () => {
    const storage = memoryStorage();
    storage.setItem("splitit:split:bad-json", "{nope");
    storage.setItem("splitit:split:bad-shape", JSON.stringify({ id: "x" }));
    expect(loadSplit("missing", storage)).toBeNull();
    expect(loadSplit("bad-json", storage)).toBeNull();
    expect(loadSplit("bad-shape", storage)).toBeNull();
  });

  it("lists valid splits newest first and ignores other keys", () => {
    const storage = memoryStorage();
    saveSplit(newSplit("old", "Sanil", "2026-01-01T00:00:00.000Z"), storage);
    saveSplit(newSplit("new", "Sanil", "2026-06-01T00:00:00.000Z"), storage);
    storage.setItem("splitit:split:broken", "{");
    storage.setItem("other", "x");
    expect(listSplits(storage).map((s) => s.id)).toEqual(["new", "old"]);
  });

  it("stores the host's name", () => {
    const storage = memoryStorage();
    expect(loadName(storage)).toBeNull();
    saveName("Sanil", storage);
    expect(loadName(storage)).toBe("Sanil");
  });
});
