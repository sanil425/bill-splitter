import type { Flag } from "../schemas";

/** Whether the user may mark this flag resolved without changing the split. */
export function isResolvable(flag: Flag): boolean {
  return flag.severity === "warning" || flag.confirmable;
}

/**
 * Combine fresh validator flags with the flags already on the split.
 *
 * - Receipt-parser and attribution flags are kept as they are.
 * - Old validator flags are replaced by `fresh`, so ones that no longer
 *   apply disappear.
 * - A fresh flag whose id was already there keeps its resolved state
 *   (only if it's resolvable; must-fix flags are never resolved).
 */
export function mergeFlags(existing: readonly Flag[], fresh: readonly Flag[]): Flag[] {
  const previous = new Map(existing.map((f) => [f.id, f]));
  const kept = existing.filter((f) => f.source !== "validator");
  const keptIds = new Set(kept.map((f) => f.id));
  const updated = fresh
    .filter((f) => !keptIds.has(f.id))
    .map((f) => {
      const old = previous.get(f.id);
      return old && isResolvable(f) ? { ...f, resolved: old.resolved } : f;
    });
  return [...kept, ...updated];
}

/**
 * True when nothing blocks calculating: every blocking flag is confirmable
 * and resolved. A must-fix flag blocks even if somehow marked resolved.
 */
export function canCalculate(flags: readonly Flag[]): boolean {
  return !flags.some((f) => f.severity === "blocking" && !(f.confirmable && f.resolved));
}

/** Mark a flag resolved. Throws for must-fix flags and unknown ids. */
export function resolveFlag(flags: readonly Flag[], id: string): Flag[] {
  const flag = flags.find((f) => f.id === id);
  if (!flag) throw new Error(`resolveFlag: no flag with id "${id}"`);
  if (!isResolvable(flag)) {
    throw new Error(`resolveFlag: "${id}" must be fixed, not confirmed`);
  }
  return flags.map((f) => (f.id === id ? { ...f, resolved: true } : f));
}
