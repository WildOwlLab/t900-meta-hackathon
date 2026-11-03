# Live smoke test record

One real round trip to a model provider, and what was reported about it.

**Provenance.** This is a transcription of what the project owner reported from
`npm run smoke:meta -- --yes`, written into the repository on 2026-11-03. It is not the script's own output.
The script saves the exact request and the raw response under `.smoke/`, which is git-ignored and was not
committed, and it never saves the key. Nothing in this repository can repeat the call without a key.

| Field | Value |
| --- | --- |
| Endpoint | `https://api.meta.ai/v1/chat/completions` |
| `META_API_URL` | `https://api.meta.ai/v1` (the code adds `/chat/completions`) |
| Model | `muse-wonder-1.0` |
| Response format | `json_schema` |
| HTTP status | 200 |
| Latency | 19658 ms |
| Usage | 4037 tokens, of which 2728 were reasoning tokens |
| Validator | PASS (1/1) |

## What it shows

- A real request to `https://api.meta.ai/v1/chat/completions` with the model `muse-wonder-1.0` was answered
  with HTTP 200, in the shape the code reads, and the answer passed the same validator that checks every
  analysis in the app: every cited passage ID exists and sits in the right bucket, every quote is an exact
  span of its passage, and repairs are passage IDs only.
- It is a reasoning-heavy call. About two thirds of the tokens (2728 of 4037) were reasoning tokens, and it
  took about 20 seconds. The benchmark makes 13 calls like it, one at a time, and both the live client and
  this script give up on a call after 60 seconds.

## What it does not show

Not recorded in the report, so not claimed here:

- When the call was made, and which example it used (the script defaults to `refund-window`).
- The response id.
- Whether `muse-wonder-1.0` is the model ID the provider returned or the one that was requested. The script
  prints the returned one on its own line, labelled "Model (as returned by provider)", and the report said
  only "Model".
- How the 4037 tokens split between the prompt and the answer.
- The negative control (`--negative-control`), which shows that a deliberately wrong key is refused. It was
  not reported.

It also says nothing about quality. It is one call on one synthetic example, and the benchmark figures are in
the [README](../README.md) and [EVALUATION.md](EVALUATION.md). Nothing in it comes from Meta's documentation,
which has still not been read (see [PROVIDER.md](PROVIDER.md)).

## Repeat it

You need your own key in `.env` (see the README). From the safest step to the broadest:

```bash
npm run smoke:meta                              # prints the exact request and sends nothing
npm run smoke:meta -- --yes --negative-control  # a deliberately bad key must be refused
npm run smoke:meta -- --yes                     # one real round trip, checked by the validator
```
