/**
 * Live receipt eval. Calls the real API (costs money); not part of npm test.
 *   npm run eval:receipts
 *
 * Parses every image in this folder. If `<name>.expected.json` exists next to
 * it, the result is compared (PASS/FAIL); otherwise it's printed in the
 * expected-file shape so you can check it and save it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { receiptModel } from "../../src/lib/ai/config";
import { RECEIPT_PROMPT, parseReceipt } from "../../src/lib/ai/receipt";
import { receiptFromAi } from "../../src/lib/schemas";
import { MAX_IMAGE_BYTES } from "../../src/lib/uploads";
import { ExpectedReceiptSchema, compareReceipt, toExpected } from "./compare";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const IMAGE = /\.(jpe?g|png|webp)$/i;

/**
 * Phone photos are usually over the 4 MB upload limit, and the app will shrink
 * them before upload, so do the same here: apply EXIF rotation, fit within
 * 2000px, re-encode as JPEG.
 */
async function prepare(file: string): Promise<Uint8Array> {
  const out = await sharp(readFileSync(file)).rotate().resize(2000, 2000, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  if (out.length > MAX_IMAGE_BYTES) throw new Error(`still ${out.length} bytes after resizing`);
  return new Uint8Array(out);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set (expected in .env.local).");
    process.exit(1);
  }
  const images = readdirSync(DIR).filter((f) => IMAGE.test(f)).sort();
  if (images.length === 0) {
    console.log(`No images in ${DIR}`);
    return;
  }
  console.log(`Receipt eval: ${images.length} image(s), model ${receiptModel()}, prompt ${RECEIPT_PROMPT}\n`);

  let passed = 0;
  let failed = 0;
  for (const name of images) {
    const base = name.replace(IMAGE, "");
    const expectedPath = path.join(DIR, `${base}.expected.json`);
    const started = Date.now();
    try {
      const data = await prepare(path.join(DIR, name));
      const ai = await parseReceipt({ data, mediaType: "image/jpeg" });
      let n = 0;
      const receipt = receiptFromAi(ai, { receiptId: base, newId: () => `${base}-${++n}` });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const lowConfidence = receipt.items.filter((i) => i.confidence < 0.8).map((i) => `${i.name} (${i.confidence})`);

      if (existsSync(expectedPath)) {
        const expected = ExpectedReceiptSchema.parse(JSON.parse(readFileSync(expectedPath, "utf8")));
        const { diffs, notes } = compareReceipt(receipt, expected);
        if (diffs.length === 0) passed++;
        else failed++;
        console.log(`${diffs.length === 0 ? "PASS" : "FAIL"}  ${name}  (${secs}s, ${receipt.items.length} items)`);
        for (const d of diffs) console.log(`      - ${d}`);
        for (const n of notes) console.log(`      note: ${n}`);
      } else {
        console.log(`NEW   ${name}  (${secs}s, ${receipt.items.length} items). Check it, then save as ${path.relative(process.cwd(), expectedPath)}:`);
        console.log(JSON.stringify(toExpected(receipt), null, 2));
      }
      if (lowConfidence.length) console.log(`      low confidence: ${lowConfidence.join(", ")}`);
      for (const line of receipt.unreadableLines) console.log(`      unreadable: ${line}`);
    } catch (e) {
      failed++;
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.log(`FAIL  ${name}  threw ${detail}`);
      for (const i of (e as { issues?: string[] }).issues ?? []) console.log(`        ${i}`);
    }
    console.log();
  }

  console.log(`${passed} passed, ${failed} failed, ${images.length - passed - failed} without expected output`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
