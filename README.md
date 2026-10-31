# T900 Meta Hackathon

A standalone Meta-powered tool for checking whether an AI context
pack contains the evidence needed to answer a task.

Built for the Meta Global AI Developer Hackathon.

## Status

Under development. Milestone 1 is in place: shared schema, validator, prompt builder,
three synthetic examples, and a gated smoke-test script. The API routes, the review UI,
and the live model integration are not built yet. No live model call has been made, so
there are no results to report.

The workflow below is planned, not yet implemented.

## Planned workflow

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
npm test             # unit and hygiene tests, no network
npm run typecheck
npm run dev:web      # placeholder UI at http://localhost:5173
npm run test:e2e     # Playwright; on a fresh machine run `npx playwright install chromium` first
```

Synthetic examples are built in. Fixture mode and live model mode will be clearly
distinguished: fixture output is hand-written and never comes from a model.

Live mode needs `META_API_KEY`, `META_API_URL` and `META_MODEL` (names only in
`.env.example`). Provider details are unverified, see [docs/PROVIDER.md](docs/PROVIDER.md).
Nothing is sent to a provider unless you run `npm run smoke:meta -- --yes`; without
`--yes` it only prints the request it would send.

## Privacy

Live inference sends user-approved passages to the selected model provider.
Do not commit API keys, private documents, or user data.

## Evaluation

No performance claims yet.
Tests, methods, results, and limitations will be documented.
