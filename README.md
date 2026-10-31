# T900 Meta Hackathon

**T900 Evidence Check** is a standalone tool that checks whether an AI context pack holds the
evidence a task needs. Built for the Meta Global AI Developer Hackathon (Indie Developer Track).

## Pre-existing work vs new hackathon work

| | |
| --- | --- |
| **Pre-existing** | **Project T900**, an existing product that predates the hackathon. Nothing from it is in this repository: no code, assets, configuration or Git history. This app does not call it, import it or depend on it, and it runs entirely on its own. No integration exists today. |
| **New in this repository** | Everything here was written during the event: the validator, prompt builder, approval gate, local API, repair engine, web UI, custom input, exports, the evaluation harness and its 13 cases, the tests, and the documentation. |
| **Third party** | Open-source libraries installed from npm (React, Vite, Hono, zod, Vitest, Playwright, axe-core, tsx), each under its own licence. The model is run by an external provider and is not part of this repository. |
| **How it was built** | With AI coding assistance (Claude Code, from Anthropic), directed and reviewed by the project owner. Commits made with that help carry a `Co-Authored-By` line. |

No pre-hackathon product code or Git history is copied into this repository.

## What it does

Give it a **task**, some **source passages** that each have a stable ID, and an **initial context
pack** (the passages already chosen). A model sorts every requirement of the task into one of four
buckets:

| Bucket | Meaning |
| --- | --- |
| **Supported** | The pack answers it. |
| **Missing Evidence** | The sources answer it, but those passages are not in the pack. |
| **Conflicting** | Passages disagree, so a person has to decide. |
| **Unanswerable** | No source answers it. |

Then:

- **Nothing is sent without your approval.** You see the exact outbound text and its SHA-256 first.
  The server refuses to run unless the approval matches that text.
- **Nothing the model says is trusted blindly.** Every cited passage ID must exist, sit in the right
  place for its bucket, and every quote must be an exact span of its passage. Output that fails is
  shown as an error, never as findings.
- **Repairs only add original passages.** A repair picks a source passage by ID. It never writes text,
  and nothing is applied until you tick it and apply it.
- **Export** the revised context pack (Markdown or text) and an evidence report (JSON or a summary).

## Try it in two minutes, with no API key

Needs Node 22 or newer.

```bash
git clone https://github.com/WildOwlLab/t900-meta-hackathon.git
cd t900-meta-hackathon
npm install
npm test
npm run dev
```

Open **http://localhost:5173**. `npm run dev` starts the API and the UI together, and `Ctrl+C` stops both.

1. Pick a built-in example. All three are synthetic, and each is labelled as such.
2. Read the **Outbound text preview**. In fixture mode nothing is sent anywhere.
3. Click **Approve & Analyze**.
4. Read the four buckets. Each finding quotes the passage it relies on.
5. Tick a proposed repair, click **Apply**, and see the revised pack.
6. Download the revised pack or the evidence report.

This is **fixture mode**, the default. Its answers are hand-written ideal outputs, they are never
produced by a model, and every screen and export says so ("Hand-written fixture. Not a model result.").
It shows the product and the safety checks. It does not show how well a model performs.

The **Custom input** tab takes your own task and passages. Fixture mode only has answers for the
built-in examples, so analysing your own text needs live mode (below).

## Try the live path without a key (stub provider)

```bash
npm run dev -- --stub
```

This also starts a small provider stand-in on `127.0.0.1:9101` and points live mode at it with a
made-up key. Choose **Live** in the UI to see the whole live path: the destination shown in the
preview, the approval, the exact bytes sent, and how errors are reported.

The stub is **not a model**. It returns hand-written answers for the three built-in examples and
refuses anything else. It never leaves your machine.

## Try it with a real key (Meta models via an OpenAI-compatible host)

```bash
cp .env.example .env        # on Windows: copy .env.example .env
```

Fill in `.env` (it is git-ignored and is read only by the server):

| Variable | What to put there |
| --- | --- |
| `META_API_KEY` | Your provider key. Never commit it or paste it into chat. |
| `META_API_URL` | The provider's OpenAI-compatible **base URL**. `/chat/completions` is added for you. |
| `META_MODEL` | The model ID from the provider's documentation. |
| `META_RESPONSE_FORMAT` | Optional. `json_schema` (default) or `json_object`. Try `json_object` if the host rejects `json_schema`. |

Values supplied by the project owner (**not yet checked against the providers' documentation**):

| Host | `META_API_URL` | `META_MODEL` |
| --- | --- | --- |
| Fireworks | `https://api.fireworks.ai/inference/v1` | `accounts/fireworks/models/muse-spark-open` |
| Baseten (alternative) | `https://bridge.baseten.co/v1` | `meta-models/muse-spark-open-1028` |

Then run `npm run dev`. **Live** becomes selectable in the UI. It is never selected for you, and the
approval step shows exactly where the text will go. A suggested first run, from safest to broadest:

```bash
npm run smoke:meta -- --yes --negative-control   # a deliberately bad key must be refused
npm run smoke:meta -- --yes                      # one real round trip, checked by the validator
npm run eval -- --analyzer live                  # PREVIEW of the benchmark run: sends nothing
npm run eval -- --analyzer live --yes            # all 13 benchmark cases against the real model
```

> **Live status:** the live path is built and tested against stubbed providers, but it has **not yet
> been run against a real endpoint**. Until it is, treat the provider table above as unverified. See
> [docs/PROVIDER.md](docs/PROVIDER.md) for the checklist.

## What to look at

| If you care about | Look at |
| --- | --- |
| Not trusting model output | [`src/server/validator.ts`](src/server/validator.ts): IDs, bucket placement, exact-span quotes, ID-only repairs |
| Control over what leaves your machine | [`src/server/approval.ts`](src/server/approval.ts) and [`src/server/app.ts`](src/server/app.ts): a hash over the mode, destination and exact request body |
| Repairs that cannot invent text | [`src/server/repair.ts`](src/server/repair.ts) |
| Measuring honestly | [`docs/EVALUATION.md`](docs/EVALUATION.md) and `npm run eval`: 13 cases, recall always shown with precision, a naive baseline, token and preservation metrics |
| Tests | `tests/unit`, `tests/api`, `tests/e2e`, `tests/hygiene`, and a stub provider for the browser tests |

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API (`127.0.0.1:8787`) and UI (`localhost:5173`) together. Add `-- --stub` for the stub provider. |
| `npm test` | Unit, API and repository-hygiene tests. No external network. |
| `npm run test:e2e` | Browser tests with Playwright. On a fresh machine run `npx playwright install chromium` first. Everything runs on `127.0.0.1`. |
| `npm run typecheck` / `npm run build` | Type-check, and a production build of the UI. |
| `npm run eval` | The benchmark: an oracle (sanity check) and a keyword baseline. Deterministic, no network. |
| `npm run smoke:meta` | One real round trip to the provider. Prints the request and sends nothing without `--yes`. |

`PORT` and `WEB_PORT` change the API and UI ports for `npm run dev`.

## Evaluation

**No model has been evaluated, and there are no performance claims.** `npm run eval` scores a
sanity-check oracle and a naive keyword baseline on 13 cases (3 built-in and 10 synthetic), and can
score a live model once you run it with credentials. The methods, today's numbers and the limitations
are in [docs/EVALUATION.md](docs/EVALUATION.md). The 13 cases are a development set written by the same
authors as the prompt and validator, not a held-out test.

## Browser support

Tested in **Chromium** through Playwright: phone, tablet and desktop widths, light and dark mode, an
automated accessibility scan, and keyboard-only use. **Firefox and Safari were not tested** in the
build environment. The CSS and the download code avoid their known problems (colour fallbacks, and
download links that stay valid for 60 seconds), but that is not the same as having run them.

## Privacy and security

- **Live mode sends** the task and **every source passage** (not only the pack), exactly as shown in the
  preview, to the host named there. Each host has its own data terms. Fixture mode sends nothing.
- The API key stays on the server. It is never sent to the browser, and it is redacted from errors.
- The server has **no login** and listens on `127.0.0.1` only. Do not expose it publicly while a key is set.
- Exports are built in your browser. Nothing is uploaded, and custom input is not stored anywhere.
- Do not commit API keys, private documents or user data. `.env` is git-ignored.

## Known limitations

- Live mode has not been verified against a real provider, and no model has been scored.
- Repairs only add passages, so a revised pack is always larger than the initial pack. A repair that
  removes passages is not built.
- Fixture mode can only analyse the three built-in examples.
- The "unanswerable" metric is matched by count only, and the benchmark has just 13 cases.
- There is no deployment and no authentication.

## Repository layout

```
src/shared/   schemas, types and the export builders, used by the server and the browser
src/server/   validator, prompt builder, approval gate, repair engine, model clients, API routes
src/web/      the React UI
src/eval/     benchmark cases, scoring and analyzers
src/examples/ the three built-in examples
scripts/      dev, eval and smoke-meta
tests/        unit, api, e2e (Playwright) and hygiene tests
docs/         PROVIDER.md (provider notes) and EVALUATION.md (method and results)
```

## Licence

MIT. See [LICENSE](LICENSE).
