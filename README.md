# T900 Meta Hackathon

A standalone Meta-powered tool for checking whether an AI context
pack contains the evidence needed to answer a task.

Built for the Meta Global AI Developer Hackathon.

## Status

Under development. Milestone 2 is in place: schema, validator, prompt builder, three
synthetic examples, a local API (preview, analyze, apply), and a browser UI with an
outbound-text preview, an explicit approval step, four-bucket findings, and repairs you
approve one by one. Fixture mode runs with no setup.

Live mode is built but has only been tested against stubbed responses. No live model call
has been made, so there are no results to report.

Not built yet: exporting the revised pack and report, pasting your own sources, and any
deployment.

## Workflow

Steps 1 to 5 work today on the three built-in examples. Step 6 is not built.

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
npm test               # unit, API and hygiene tests, no network
npm run typecheck
npm run test:e2e       # Playwright, fixture mode only; on a fresh machine run `npx playwright install chromium` first
```

### Modes

- **Fixture** is the default and needs no setup. Its output is hand-written and never comes
  from a model, and every result says so. Nothing is sent anywhere.
- **Live** turns on only when `META_API_KEY`, `META_API_URL` and `META_MODEL` are all set on
  the server (names only in `.env.example`). The UI then offers it as a choice. It is never
  selected for you, and a key is never sent to the browser.

The server has no login and listens on `127.0.0.1` only. Do not expose it publicly while a
key is configured.

### Approval

Every analysis starts with a preview of the exact outbound text and its SHA-256. The server
runs only if the approval hash matches that text, so the request cannot change after you
approve it, and an approval given in fixture mode cannot authorise a live send. Repairs are
never applied until you tick them and apply them. A repair only adds an original source
passage to the pack by ID and writes no text.

### Provider

Provider details are unverified, see [docs/PROVIDER.md](docs/PROVIDER.md). `META_API_URL` is
the provider's OpenAI-compatible base URL, and `/chat/completions` is added to it. Nothing
reaches a provider unless you approve it in the UI in live mode, or run
`npm run smoke:meta -- --yes`; without `--yes` the script only prints the request it would send.

## Privacy

Live inference sends user-approved passages to the selected model provider.
Do not commit API keys, private documents, or user data.

## Evaluation

No performance claims yet.
Tests, methods, results, and limitations will be documented.
