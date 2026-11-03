# Provider notes

**Status: partly verified by a live run.** The facts below were supplied by the project
owner in the build session on 2026-10-31. On 2026-11-02 and 2026-11-03 the project owner
reported a successful live run against the Meta Model API with the model `muse-wonder-1.0`:
one smoke call ([SMOKE.md](SMOKE.md)) and the 13-case benchmark (see "What the live run
confirmed"). We still have not read Meta's official documentation: when we tried, the
sandbox network policy blocked the documentation hosts. A working call shows what the host
accepted, not what it documents. Treat an item as confirmed only if it is marked verified or
ticked, and treat the rest as unverified until this file links to the official pages.

## Event (as supplied)

- Meta Global AI Developer Hackathon, Indie Developer Track.
- Judging rubric: Impact 30%, Use of Meta AI Tooling 25%, Technical Depth & Execution 20%,
  Demo 25%.
- Deadline, submission contents and team rules: not provided yet.

## Eligible models (as supplied)

- Meta Model API, Muse Spark series.
- Meta open-weight models: Muse Glimmer, Muse Spark Open.

The live run used `muse-wonder-1.0`. That ID is not named in the list above, and nothing in
this repository shows whether it belongs to the Muse Spark series. Check with the
organizers, or in the official docs, before submitting.

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

## What the live run confirmed (reported by the project owner, 2026-11-02 and 2026-11-03)

The project owner ran the live path with their own key. This repository holds their report. The raw run
output is not in it, and [SMOKE.md](SMOKE.md) is a transcription of the smoke call, not the script's own
output.

| Setting | Value | Status |
| --- | --- | --- |
| `META_API_URL` | `https://api.meta.ai/v1` | Verified by the live run. The code adds `/chat/completions`, giving `https://api.meta.ai/v1/chat/completions` |
| `META_MODEL` | `muse-wonder-1.0` | Verified by the live run |
| `META_RESPONSE_FORMAT` | `json_schema` | Verified by the live run. `json_object` was not tried |
| `META_API_KEY` | not recorded here | A key never goes in this repository |

"Verified" here means a live run worked with that value. It does not mean the value is documented: the
official documentation has still not been read.

- **Host and model:** the Meta Model API, with `muse-wonder-1.0`. The integration target above was Muse
  Spark. Fireworks and Baseten were not used.
- **What ran:** one smoke call (`npm run smoke:meta -- --yes`: HTTP 200, 19658 ms, 4037 tokens of which
  2728 were reasoning tokens, validator PASS 1/1), recorded in [SMOKE.md](SMOKE.md), and the live analyzer on
  the 13-case benchmark (`npm run eval -- --analyzer live --yes`), reported in the README and in
  [EVALUATION.md](EVALUATION.md).
- **What that confirms:** for this model, the host accepted the request the code builds (URL, bearer key,
  `model`, `messages` and a `json_schema` `response_format`) and answered in the shape the code reads
  (`choices[0].message.content`). The smoke answer passed the validator.
- **What it does not confirm:**
  - Anything in Meta's documentation. A working call is not the same as a documented one.
  - Whether the host enforces `json_schema` or only accepts it. The validator checks every answer either way.
  - That `muse-wonder-1.0` is an eligible model (see above).
  - Rate limits, quota and data terms.
  - The negative control (`--negative-control`), which was not reported.
  - The live Downstream Comparison, which has only been run against the stub.
  - How the system does on data the authors did not write. The 13 cases are a development set.

## What the code assumes

Each row is a guess to confirm against the official docs. Change the code, not this
table, when a row turns out to be wrong, then update the row.

| Item | What the code does | Status |
| --- | --- | --- |
| Endpoint | Takes `META_API_URL` as a base URL and adds `/chat/completions` unless it is already there. Nothing is hard-coded. | Verified by the live run on the Meta Model API (`https://api.meta.ai/v1`). Not checked against documentation, and not tried on Fireworks or Baseten |
| Model ID | Takes it from `META_MODEL`. Nothing is hard-coded. | `muse-wonder-1.0` was accepted in the live run. The supplied Fireworks and Baseten IDs were not tried |
| Auth | `Authorization: Bearer <META_API_KEY>`, the usual convention for OpenAI-compatible APIs | Worked in the live run. Not checked against documentation |
| Request body | `model`, `messages` (one system, one user), and `response_format` | Accepted in the live run. Not checked against documentation |
| Response format | `json_schema` (default): `response_format: { type: "json_schema", json_schema: { name, schema } }`. `json_object`: `response_format: { type: "json_object" }`, with the same schema written into the system prompt. Chosen with `META_RESPONSE_FORMAT`. | `json_schema` verified by the live run. `json_object` was not tried here |
| `strict` | Not sent. The owner's note says "strict json_schema". The validator already rejects any output that breaks the schema, whether or not the provider enforces it. | Try `strict: true` in a smoke run only if the host documents it |
| Not sent | `temperature`, max tokens, `top_p`, `seed`, `strict`, `stream` | Add each only after the docs confirm it, and only with a reason |
| Response | `choices[0].message.content` is a string holding the JSON. Top-level `model`, `id` and `usage` are printed if present. | `choices[0].message.content` worked in the live run. Whether `model`, `id` and `usage` come back was not recorded |
| Downstream comparison | A plain chat completion: `model` and `messages` (one system, one user) with no `response_format`. Two are sent per comparison, in parallel, with the same system prompt and different passages. `choices[0].message.content` is read as free text and shown as plain text. | Not part of the live run. Only exercised against the stub |
| Schema keywords | Only `type`, `properties`, `required`, `items`, `enum`, `additionalProperties`. Constraint keywords such as `minLength` and `pattern` are stripped, and the validator enforces them. | Accepted by the host in the live run, sent with `json_schema`. Whether it enforces them was not tested |
| Output format | Bare JSON. A Markdown code fence is rejected as invalid. | Revisit if the provider fences output |
| Context limits | `LIMITS` in `src/shared/types.ts` are provisional caps. | Needs the model's real context window |

## Checklist

The first live call has been made (see above). Only items the repository can back up are
ticked. Unticked means not recorded here, which is not the same as not done.

- [ ] Read the official Meta Model API docs and link the exact pages here.
- [x] Confirm the chat completions URL, auth scheme and request field names. (Confirmed by
      the live run on the Meta Model API, not from documentation.)
- [ ] Confirm the model ID for Muse Spark that this account can call, and that it supports
      `json_schema` or `json_object` (set `META_RESPONSE_FORMAT` to match). Partly done:
      `muse-wonder-1.0` is callable from this account and accepts `json_schema`, but it is
      not named Muse Spark.
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
      `npm run smoke:meta -- --yes`, and record the real results in `docs/SMOKE.md`. Partly
      done: the `--yes` call is recorded in `docs/SMOKE.md`. The negative control was not
      reported.

## Privacy

Live mode sends the text shown in the outbound preview to the host that `META_API_URL`
names. That text includes the task and every source passage, not only the pack. Fixture
mode sends nothing anywhere, and the preview says so.

A live Downstream Comparison sends the task and the passages of each pack (the initial pack and the
repaired pack, not every source) in two requests. It has its own preview, hash and approval, and an
approval for a plain analysis cannot authorise it.
