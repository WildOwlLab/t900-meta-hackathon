# T900 Meta Hackathon

A standalone Meta-powered tool for checking whether an AI context
pack contains the evidence needed to answer a task.

Built for the Meta Global AI Developer Hackathon.

## Status

Under development. Milestone 3 is in place: a local API (preview, analyze, apply), and a browser
UI with an outbound-text preview, an explicit approval step, four-bucket findings, repairs you
approve one by one, custom input (paste your own task and passages), and exports of the revised
pack and the evidence report. A reproducible benchmark runner (`npm run eval`) scores 13 cases
against gold labels. Fixture mode runs with no setup.

Live mode is built but has only been tested against stubbed responses, including a stub provider
on `127.0.0.1` in the browser tests. **No live model call has been made**, so there are no model
results to report. The benchmark's numbers come from a sanity-check oracle and a naive keyword
baseline, and they are labelled as such. See [docs/EVALUATION.md](docs/EVALUATION.md).

Not built yet: any deployment, and a repair that removes passages (repairs only add).

## Workflow

All six steps work: on the built-in examples in fixture mode, and on your own text in live mode.

1. Provide a task, source passages, and an initial context pack.
2. Preview and approve the text sent to the model provider.
3. Identify supported requirements, missing evidence, and conflicts.
4. Distinguish missing evidence from questions the sources cannot answer.
5. Review proposed repairs using original source passages.
6. Export the revised context pack and evidence report.

## Pre-existing work

Project T900 existed before the hackathon.

This repository contains only new work completed during the event.
No pre-hackathon product code or Git history is copied into it.

Any integration with the existing T900 product will be optional,
documented, and separate from the standalone execution path.

## Setup

Requires Node 22 or newer.

```bash
npm install
npm run start:server   # API on http://127.0.0.1:8787, loopback only
npm run dev:web        # UI at http://localhost:5173 (second terminal)
npm test               # unit, API and hygiene tests, no external network
npm run typecheck
npm run test:e2e       # Playwright; on a fresh machine run `npx playwright install chromium` first
npm run eval           # benchmark: oracle + keyword baseline, deterministic, no network
```

### Modes

- **Fixture** is the default and needs no setup. Its output is hand-written and never comes
  from a model, and every result says so. Nothing is sent anywhere.
- **Live** turns on only when `META_API_KEY`, `META_API_URL` and `META_MODEL` are all set on
  the server (names only in `.env.example`). The UI then offers it as a choice. It is never
  selected for you, and a key is never sent to the browser.

The server has no login and listens on `127.0.0.1` only. Do not expose it publicly while a
key is configured.

### Your own input

The **Custom input** tab takes a task, source passages with IDs, and a tick for each passage that
is already in the context pack. Pasted text is split into passages on blank lines and given IDs
`p1`, `p2`, and so on, which you can edit. Nothing is stored. Fixture mode only has hand-written
answers for the built-in examples, so analysing your own text needs live mode. The preview still
shows exactly what live mode would send.

### Export

After an analysis you can download the revised context pack (Markdown or plain text) and the
evidence report (JSON, or a readable summary). Files are built in your browser and nothing is
uploaded. Passage text is copied from your sources unchanged, and every file says where the
analysis came from. A fixture export says it is not a model result. The JSON report carries the
sources, the analysis and the approval hash, so it can be re-validated on its own.

### Approval

Every analysis starts with a preview of the exact outbound text and its SHA-256. The server
runs only if the approval hash matches that text, so the request cannot change after you
approve it, and an approval given in fixture mode cannot authorise a live send. Repairs are
never applied until you tick them and apply them. A repair only adds an original source
passage to the pack by ID and writes no text.

### Provider

Provider details are unverified, see [docs/PROVIDER.md](docs/PROVIDER.md). `META_API_URL` is
the provider's OpenAI-compatible base URL, and `/chat/completions` is added to it. Nothing
reaches a provider unless you approve it in the UI in live mode, or run one of the two scripts
below with `--yes`. Without `--yes` each script only prints what it would send.

```bash
npm run smoke:meta -- --yes --negative-control   # a deliberately bad key must be refused
npm run smoke:meta -- --yes                      # one real round trip, checked by the validator
npm run eval -- --analyzer live --yes            # all 13 benchmark cases against the real model
```

## Privacy

Live inference sends user-approved passages to the selected model provider.
Do not commit API keys, private documents, or user data.

## Evaluation

No model has been evaluated, and there are no performance claims. `npm run eval` scores an
oracle (a sanity check) and a naive keyword baseline on 13 cases, and can score a live model once
you run it with credentials. Methods, the numbers so far, and the limitations are in
[docs/EVALUATION.md](docs/EVALUATION.md). The 13 cases are a development set written by the same
authors as the prompt and validator, not a held-out test.
