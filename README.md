# SplitIt

Split a bill from a photo of the receipt and a quick voice note or text saying who had what.

One person (the host) snaps the receipt(s) and describes who ordered what. SplitIt reads the items, works out each person's share (including tax, tip and any custom rules like "I'll cover Sam's drinks"), flags anything that doesn't add up, and drafts a text for each person with what they owe, a Venmo link, and a link to their itemised breakdown.

AI reads receipts and notes; plain, tested code does all the maths, in integer cents, so totals always add up exactly.

> Status: early development. This is the project skeleton only.

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + TypeScript
- Tailwind CSS
- Installable PWA
- Zod for data validation
- Vitest for tests

## Running locally

Requires Node.js 20.9+ (developed on Node 24).

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts:

```bash
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm test           # Vitest (single run); npm run test:watch to watch
npm run build      # production build
```
