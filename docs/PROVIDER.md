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

## Provider hosts (as supplied, second message, 2026-10-31)

Both are OpenAI-compatible chat completions hosts for an open-weight model. These values
were given to us and have not been checked: we have not contacted either host.

| Host | `META_API_URL` | `META_MODEL` |
| --- | --- | --- |
| Fireworks (primary) | `https://api.fireworks.ai/inference/v1` | `accounts/fireworks/models/muse-spark-open` |
| Baseten (fallback) | `https://bridge.baseten.co/v1` | `meta-models/muse-spark-open-1028` |

Things to know before relying on them:

- **Not Meta's own API.** These are third-party hosts of Muse Spark Open. The eligibility
  list we were given includes Meta's open-weight models, so this should be allowed. The
  rubric line "Use of Meta AI Tooling" may still weigh Meta's own API more heavily. Worth
  asking the organizers.
- **No automatic failover.** "Fallback" means you change the environment variables and
  restart. The approval names exactly one destination, so the app never quietly sends the
  same text to a second provider.
- **Each host has its own data terms.** Read Fireworks' or Baseten's terms, not only Meta's,
  before sending anything real.

## Rules we build to (as supplied)

- Keep the four-bucket classification: `supported`, `missing_evidence`, `conflicting`,
  `unanswerable`.
- Repairs are strict passage ID selections. The repair engine generates no text.

## What the code assumes

Each row is a guess to confirm against the official docs. Change the code, not this
table, when a row turns out to be wrong, then update the row.

| Item | What the code does | Status |
| --- | --- | --- |
| Endpoint | Takes `META_API_URL` as a base URL and adds `/chat/completions` unless it is already there. Nothing is hard-coded. | The `/chat/completions` suffix is the OpenAI-compatible convention, unverified for these hosts |
| Model ID | Takes it from `META_MODEL`. Nothing is hard-coded. | Supplied, unverified |
| Auth | `Authorization: Bearer <META_API_KEY>`, the usual convention for OpenAI-compatible APIs | Unverified |
| Request body | `model`, `messages` (one system, one user), and `response_format` | Field names unverified |
| Response format | `json_schema` (default): `response_format: { type: "json_schema", json_schema: { name, schema } }`. `json_object`: `response_format: { type: "json_object" }`, with the same schema written into the system prompt. Chosen with `META_RESPONSE_FORMAT`. | Which one a host accepts is unverified. The first live smoke run should try both. |
| `strict` | Not sent. The owner's note says "strict json_schema". The validator already rejects any output that breaks the schema, whether or not the provider enforces it. | Try `strict: true` in a smoke run only if the host documents it |
| Not sent | `temperature`, max tokens, `top_p`, `seed`, `strict`, `stream` | Add each only after the docs confirm it, and only with a reason |
| Response | `choices[0].message.content` is a string holding the JSON. Top-level `model`, `id` and `usage` are printed if present. | Unverified |
| Downstream comparison | A plain chat completion: `model` and `messages` (one system, one user) with no `response_format`. Two are sent per comparison, in parallel, with the same system prompt and different passages. `choices[0].message.content` is read as free text and shown as plain text. | Same assumptions as the rows above, unverified |
| Schema keywords | Only `type`, `properties`, `required`, `items`, `enum`, `additionalProperties`. Constraint keywords such as `minLength` and `pattern` are stripped, and the validator enforces them. | Provider support unverified |
| Output format | Bare JSON. A Markdown code fence is rejected as invalid. | Revisit if the provider fences output |
| Context limits | `LIMITS` in `src/shared/types.ts` are provisional caps. | Needs the model's real context window |

## Checklist before the first live call

- [ ] Read the official Meta Model API docs and link the exact pages here.
- [ ] Confirm the chat completions URL, auth scheme and request field names.
- [ ] Confirm the model ID for Muse Spark that this account can call, and that it supports
      `json_schema` or `json_object` (set `META_RESPONSE_FORMAT` to match).
- [ ] Confirm the chosen host's own data terms, not only Meta's.
- [ ] Confirm which `response_format` schema keywords are supported.
- [ ] Confirm rate limits, quota and any hackathon credits.
- [ ] Read the data terms: retention, whether inputs are used for training, and
      availability in the account's country. Update the README privacy section to match.
- [ ] Confirm the hackathon rules allow this use of the model, and what the submission
      must contain.
- [ ] In live mode, apply a repair and run the Downstream Comparison once. Read the preview of both
  requests first, then read both answers.
- [ ] Put `META_API_KEY`, `META_API_URL` and `META_MODEL` in the environment. Never paste
      the key into chat or commit it.
- [ ] Run `npm run smoke:meta` without `--yes` and read the request body.
- [ ] Run `npm run smoke:meta -- --yes --negative-control`, then
      `npm run smoke:meta -- --yes`, and record the real results in `docs/SMOKE.md`.

## Privacy

Live mode sends the text shown in the outbound preview to the host that `META_API_URL`
names. That text includes the task and every source passage, not only the pack. Fixture
mode sends nothing anywhere, and the preview says so.

A live Downstream Comparison sends the task and the passages of each pack (the initial pack and the
repaired pack, not every source) in two requests. It has its own preview, hash and approval, and an
approval for a plain analysis cannot authorise it.
