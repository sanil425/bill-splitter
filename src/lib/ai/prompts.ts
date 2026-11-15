import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Runtime prompts live in /prompts as versioned markdown files. They're read
 * from disk once per process (next.config.ts includes them in the server
 * trace for the routes that need them).
 */
const cache = new Map<string, string>();

export function loadPrompt(name: string): string {
  let text = cache.get(name);
  if (text === undefined) {
    text = readFileSync(path.join(process.cwd(), "prompts", `${name}.md`), "utf8").trim();
    cache.set(name, text);
  }
  return text;
}
