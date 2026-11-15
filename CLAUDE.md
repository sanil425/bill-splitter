# SplitIt

Mobile-first web app (PWA) that splits a bill from receipt photos plus voice notes or texts saying who had what. One person (the host) runs the split, reviews flags, then texts each person what they owe with a link to an itemised breakdown.

@AGENTS.md

## Rules for working with me

- Do NOT run `git commit` or `git push`. I make all commits myself.
- Never add "Co-Authored-By" or any AI attribution anywhere (commits, PRs, code, docs).
- At the end of each phase, suggest how to split the work into a few small commits with messages.
- Keep things simple; don't build ahead of the current phase.

## Architecture

- **Pipeline:** receipt photo → vision model (items, prices, confidence, unreadable lines) | voice note → speech-to-text | text as-is. Then one attribution call → people, item shares with weights, custom rules, flags. **AI never does maths.**
- **Validator** (our code, `src/lib/validator`) adds flags: items not summing to subtotal, unassigned items, rule conflicts. Blocking flags must be fixed before calculating.
- **Calculator** (our code, `src/lib/calculator`; pure function, integer cents): item shares → tax/tip/service (proportional or equal, set per charge) → custom rules (`covers_fraction`, `pays_charge`, `pays_fixed`) → largest-remainder rounding so totals add up exactly. Each receipt's charges are split using only that receipt's items.
- Validator and calculator run on the phone; edits recalculate instantly with no AI call.
- **Output:** itemised breakdown, share link (`/s/[id]`), drafted SMS and Venmo link per person.

## v1 scope

Multiple receipts, voice + text, no-receipt mode, USD/English only, no accounts.

## Stack

- Next.js 16 (App Router, `src/` dir) + TypeScript strict, Tailwind v4, PWA (`src/app/manifest.ts`; no service worker yet)
- Zod for all data shapes (`src/lib/schemas`), Vitest for tests
- Claude Sonnet 5.5 (receipts + attribution, `@anthropic-ai/sdk`), OpenAI `gpt-transcribe` (`openai`), Upstash Redis + `@upstash/ratelimit` (rate limits now; share links later), `music-metadata` (audio duration)
- Later: Vercel

## Layout

- `src/lib/schemas`, `src/lib/calculator`, `src/lib/validator`, `src/lib/ai`, `src/lib/ratelimit`
- `src/lib/uploads.ts` (size limits, file type sniffing, audio duration), `src/lib/http.ts` (route helpers)
- `src/components`, `src/app/api`
- `prompts/`: runtime prompts; `evals/`: AI pipeline test cases

## Conventions

- Money is always integer cents. Use `toCents` / `formatCents` from `src/lib/money.ts`; never do float maths on dollars.
- `src/lib/schemas/domain.ts`: what the app stores (cents, ids). `ai.ts`: what models return (dollars; people referenced by name). `convert.ts` maps AI → domain.
- Types come from `z.infer` only; no hand-written duplicate types. Import from `@/lib/schemas`.
- Schemas check shape only; cross-references (item/person ids exist, rule conflicts) belong to the validator.
- `Item.lineTotalCents` is the only item number the maths uses. It's `null` when the price is unreadable (the validator must block until fixed). `unitPriceCents` and `quantity` are optional and display-only. The vision model returns `lineTotal` (dollars, nullable); `unreadableLines` is only for text that can't be tied to any item.
- Calculator (`calculate(split)` in `src/lib/calculator`): pure, integer cents, every split goes through `allocate()` (largest remainder; ties go to earlier people in `split.people`). It throws a typed `CalculationError` (with a `code`) instead of ever returning a doubtful number.
- Calculator choices: proportional charges ignore negative item subtotals and fall back to an equal split if nobody has a positive subtotal; `covers_fraction` takes its fraction of the beneficiary's total **before any rules** (after items and charges), so "Ali pays half of Josh's" + "Sam pays half of Josh's" leaves Josh at exactly $0 (moved amounts round the cumulative fraction, so pieces always add up); `covers_fraction` on a zero/negative pre-rule total moves nothing; rules still apply in order, and a rule may not push anyone's total below zero (or further below).
- Flags have a `code` (`FlagCodeSchema` in `common.ts`) and `confirmable`. There are three kinds: blocking must-fix (`confirmable: false`), blocking confirmable (the user can say "yes, really"), and warnings (always dismissable). AI flags use `MODEL_FLAG` and are confirmable.
- Validator (`validate(split)` in `src/lib/validator`): pure, returns `Flag[]`. Every code's severity and confirmability is in `FLAG_KINDS`. Validator flag ids are deterministic: `CODE:id[:id…]` (rules use `rule_<index>`), so resolved state survives re-runs. Messages use names, never ids.
- Every precondition `calculate()` checks has its own must-fix code. When there are no must-fix flags, `validate` dry-runs `calculate()` and turns a `CalculationError` into `CALCULATION_FAILED`. Guarantee: `canCalculate(mergeFlags(split.flags, validate(split)))` ⇒ `calculate(split)` won't throw.
- After every edit: `split.flags = mergeFlags(split.flags, validate(split))`. It keeps receipt/attribution flags, replaces validator flags, and carries resolved state by id. `resolveFlag` throws for must-fix flags; `canCalculate` ignores `resolved` on must-fix flags.
- AI calls (`src/lib/ai`, server-only) share `callTool()` in `tool-call.ts`: one tool (input schema from the Zod schema via `toolFromSchema`), `tool_choice: auto` + the prompt (current models reject forced `tool_choice`); a reply without the call or failing the check is retried once with the errors sent back, then throws an `AiError` subclass with a `code` (`API_ERROR`, `REFUSED`, `TRUNCATED`, `INVALID_RESPONSE`). No refusal fallback. `attribute()` (`submit_attribution`, also checks item ids/host) throws `AttributionError`; `parseReceipt()` (`submit_receipt`, one image) throws `ReceiptParseError`; `transcribe()` (OpenAI, no retry loop) throws `TranscriptionError`. SDK clients live in `client.ts` and are injectable (tests pass fakes from `test-helpers.ts` or mock `getMessagesClient`/`getTranscriptionClient`). Models: `ATTRIBUTION_MODEL`, `RECEIPT_MODEL`, `TRANSCRIBE_MODEL` env vars with defaults in `config.ts`.
- AI routes: `POST /api/attribute` (JSON), `POST /api/parse-receipt` (multipart `image`: JPEG/PNG/WebP, ≤4 MB → domain `Receipt`, 422 `NO_ITEMS` if empty), `POST /api/transcribe` (multipart `audio`: webm/mp4/m4a/mp3, ≤4 MB and ≤3 min → `{ text }`). File types come from the bytes, never the declared type. Order: validate input (400/413) → `checkRateLimit()` (429/503) → AI call (502 with `code` only, 500 for anything else). Errors are `{ error: { code, message } }`, never internals. Uploads stay under Vercel's 4.5 MB body limit, so the client must shrink photos.
- Rate limits (`src/lib/ratelimit`): per-IP sliding window + global daily cap (UTC day), env `RATE_LIMIT_IP_REQUESTS` / `RATE_LIMIT_IP_WINDOW` / `RATE_LIMIT_DAILY_CAP` (defaults 20 per `10 m`, 500/day). Fails closed: missing Redis env, Redis errors or a >3 s check → 503 `RATE_LIMIT_UNAVAILABLE` (library timeout is off because it fails open). Tests mock `getLimiters` in `limiters.ts` with `fakeLimiters()`.
- Runtime prompts are versioned files in `prompts/` (current: `attribution.v2.md`, `receipt.v1.md`), read via `loadPrompt()`; add new ones to `outputFileTracingIncludes` in `next.config.ts`. Change a prompt's behaviour → new version file, and rerun its eval.
- Live evals (`npm run eval:<name>`) call the real API and cost money; they're never part of `npm test`.
- Mismatch tolerance is 2 cents (`TOLERANCE_CENTS`); low confidence is < 0.8. The printed tip is ignored when `tipOverride` is set (same as the calculator).

## Commands

- `npm run dev` / `build` / `lint` / `typecheck` / `test`
- `npm run eval:attribution`: live attribution eval (needs `ANTHROPIC_API_KEY` in `.env.local`)
- `npm run eval:receipts`: live receipt eval over every image in `evals/receipts/`; compares with `<name>.expected.json` if present, else prints the result to save as one
- All of lint, typecheck, test and build should pass before a phase is done.

## Build plan (one prompt per phase)

1 setup · 2 schemas · 3 calculator · 4 validator · 5 attribution API · 6 receipt API · 7 capture UI · 8 review UI · 9 breakdown UI · 10 voice · 11 share/send · 12 hardening · 13 evals · 14 polish
