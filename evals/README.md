# evals

Test cases for the AI pipeline. Live evals call the real API (cost money) and are run by hand, never by `npm test`.

- `attribution/`: sample receipt + 5 typed cases (prompt `attribution.v2`). Run with `npm run eval:attribution`. Offline sanity checks for the cases live in `compare.test.ts`.
- `receipts/`: receipt photos. Run with `npm run eval:receipts`. Each image is rotated, shrunk to fit 2000px and parsed. If `<name>.expected.json` exists, amounts are compared (item line totals + subtotal/tax/tip/service/total must match exactly; names are only notes) and it prints PASS/FAIL. Otherwise it prints the result in that shape: check it by hand and save it as `<name>.expected.json`. In an expected file, a charge set to `null` must be absent and a missing key isn't checked.

The full eval suite comes in phase 13.
