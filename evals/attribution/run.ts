/**
 * Live attribution eval. Calls the real API (costs money); not part of npm test.
 *   npm run eval:attribution
 */
import { attribute } from "../../src/lib/ai/attribute";
import { attributionModel } from "../../src/lib/ai/config";
import { attributionFromAi } from "../../src/lib/schemas";
import { CASES, SAMPLE_RECEIPT_ITEMS } from "./cases";
import { compareAttribution } from "./compare";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set (expected in .env.local).");
    process.exit(1);
  }
  console.log(`Attribution eval: ${CASES.length} cases, model ${attributionModel()}\n`);

  let passed = 0;
  for (const c of CASES) {
    const started = Date.now();
    let diffs: string[];
    let flags: string[] = [];
    try {
      const res = await attribute({ items: SAMPLE_RECEIPT_ITEMS, messages: c.messages, hostName: c.hostName });
      attributionFromAi(res); // conversion must work too
      diffs = compareAttribution(res, c.expected, c.hostName);
      flags = res.flags.map((f) => `[${f.severity}] ${f.message}`);
    } catch (e) {
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      const issues = (e as { issues?: string[] }).issues ?? [];
      diffs = [`threw ${detail}`, ...issues.map((i) => `  ${i}`)];
    }

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (diffs.length === 0) passed++;
    console.log(`${diffs.length === 0 ? "PASS" : "FAIL"}  ${c.name}  (${secs}s)`);
    for (const d of diffs) console.log(`      - ${d}`);
    for (const f of flags) console.log(`      flag ${f}`);
  }

  console.log(`\n${passed}/${CASES.length} passed`);
  process.exit(passed === CASES.length ? 0 : 1);
}

main();
