# prompts

Runtime prompts for the AI calls, versioned. Change behaviour → new version file, then rerun its eval.

- `receipt.v1.md`: receipt photo → items and charges (`/api/parse-receipt`).
- `attribution.v2.md`: notes → who had what (`/api/attribute`). v2 stops flagging unclaimed items (the validator does). `v1` is kept for history.
