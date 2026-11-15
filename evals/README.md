# evals

Test cases for the AI pipeline. Live evals call the real API (cost money) and are run by hand, never by `npm test`.

- `attribution/`: sample receipt + 5 typed cases. Run with `npm run eval:attribution`. Offline sanity checks for the cases live in `compare.test.ts`.

The full eval suite comes in phase 13.
