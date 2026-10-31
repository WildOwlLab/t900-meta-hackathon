# Provider notes

**Status: unverified.** The facts below were supplied by the project owner in the build
session on 2026-10-31. We have not read Meta's official documentation for the Meta Model
API: when we tried, the sandbox network policy blocked the documentation hosts. No live
call has been made. Treat nothing here as confirmed until the checklist at the bottom is
done and this file links to the official pages.

## Event (as supplied)

- Meta Global AI Developer Hackathon, Indie Developer Track.
- Judging rubric: Impact 30%, Use of Meta AI Tooling 25%, Technical Depth & Execution 20%,
  Demo 25%.
- Deadline, submission contents and team rules: not provided yet.

## Eligible models (as supplied)

- Meta Model API, Muse Spark series.
- Meta open-weight models: Muse Glimmer, Muse Spark Open.

## Integration target (as supplied)

- Muse Spark through the Meta Model API.
- OpenAI-compatible chat completions interface.
- `json_schema` / structured outputs.

## Rules we build to (as supplied)

- Keep the four-bucket classification: `supported`, `missing_evidence`, `conflicting`,
  `unanswerable`.
- Repairs are strict passage ID selections. The repair engine generates no text.

## What the code assumes

Each row is a guess to confirm against the official docs. Change the code, not this
table, when a row turns out to be wrong, then update the row.

| Item | What the code does | Status |
| --- | --- | --- |
| Endpoint | Takes the full URL from `META_API_URL`. Nothing is hard-coded. | Needs the official URL |
| Model ID | Takes it from `META_MODEL`. Nothing is hard-coded. | Needs the official ID |
| Auth | `Authorization: Bearer <META_API_KEY>`, the usual convention for OpenAI-compatible APIs | Unverified |
| Request body | `model`, `messages` (one system, one user), `response_format: { type: "json_schema", json_schema: { name, schema } }` | Field names unverified |
| Not sent | `temperature`, max tokens, `top_p`, `seed`, `strict`, `stream` | Add each only after the docs confirm it, and only with a reason |
| Response | `choices[0].message.content` is a string holding the JSON. Top-level `model`, `id` and `usage` are printed if present. | Unverified |
| Schema keywords | Only `type`, `properties`, `required`, `items`, `enum`, `additionalProperties`. Constraint keywords such as `minLength` and `pattern` are stripped, and the validator enforces them. | Provider support unverified |
| Output format | Bare JSON. A Markdown code fence is rejected as invalid. | Revisit if the provider fences output |
| Context limits | `LIMITS` in `src/shared/types.ts` are provisional caps. | Needs the model's real context window |

## Checklist before the first live call

- [ ] Read the official Meta Model API docs and link the exact pages here.
- [ ] Confirm the chat completions URL, auth scheme and request field names.
- [ ] Confirm the model ID for Muse Spark that this account can call, and that it supports
      `json_schema`.
- [ ] Confirm which `response_format` schema keywords are supported.
- [ ] Confirm rate limits, quota and any hackathon credits.
- [ ] Read the data terms: retention, whether inputs are used for training, and
      availability in the account's country. Update the README privacy section to match.
- [ ] Confirm the hackathon rules allow this use of the model, and what the submission
      must contain.
- [ ] Put `META_API_KEY`, `META_API_URL` and `META_MODEL` in the environment. Never paste
      the key into chat or commit it.
- [ ] Run `npm run smoke:meta` without `--yes` and read the request body.
- [ ] Run `npm run smoke:meta -- --yes --negative-control`, then
      `npm run smoke:meta -- --yes`, and record the real results in `docs/SMOKE.md`.

## Privacy

Live mode sends the text shown in the outbound preview to the model provider. That text
includes the task and every source passage, not only the pack. Fixture mode sends nothing
anywhere.
