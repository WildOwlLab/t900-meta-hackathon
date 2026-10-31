# T900 Meta Hackathon

A standalone Meta-powered tool for checking whether an AI context
pack contains the evidence needed to answer a task.

Built for the Meta Global AI Developer Hackathon.

## Status

Under development. The workflow below is planned, not yet implemented.

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

Instructions will be added with the first runnable version.
Synthetic examples will be included.
Fixture mode and live model mode will be clearly distinguished.

## Privacy

Live inference sends user-approved passages to the selected model provider.
Do not commit API keys, private documents, or user data.

## Evaluation

No performance claims yet.
Tests, methods, results, and limitations will be documented.
