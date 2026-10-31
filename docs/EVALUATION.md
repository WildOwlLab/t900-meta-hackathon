# Evaluation

**Status: no model has been evaluated.** No live call has been made. This file holds no
results yet, and the README makes no performance claim.

## What the automated tests show

The tests cover the schema, validator, prompt builder, built-in examples, the smoke script's
gates, and repository hygiene. They run without a network.

They show that our own code behaves as designed. They show **nothing about model quality**:
no model is involved, and the fixtures are hand-written ideal outputs. A passing test run
is not an evaluation result.

## Rules this project holds itself to

- Every requirement lands in exactly one of four buckets: `supported`, `missing_evidence`,
  `conflicting`, `unanswerable`.
- Repairs are strict passage ID selections. The repair engine generates no text, and a
  repair that carries any text is rejected.

## Judging rubric and what we plan to show

Weights are as supplied by the project owner. This is a plan, not a claim.

| Criterion | Weight | What we plan to show |
| --- | --- | --- |
| Impact | 30% | The four-way split, which tells a user what to fix (add evidence), what to decide (resolve a conflict), and what no source can answer. Evidence: worked examples, including failures. |
| Use of Meta AI Tooling | 25% | A real call to the target Meta model with structured output, recorded in `docs/SMOKE.md`, with the model ID the provider returned. |
| Technical Depth & Execution | 20% | Deterministic validation of every cited ID and quote, an approval gate on outbound text and on repairs, and tests for each. |
| Demo | 25% | A fixture mode that works offline and a clearly labelled live mode, so the demo cannot fail on a network problem. |

## Method (planned)

- **Unit of comparison: passage IDs.** Requirement text is written by the model and cannot
  be matched to a gold label. Passage IDs are stable, so each example's `expected` facts
  (`src/examples/`) list which passages belong in each bucket.
- **Gold labels are written separately from the fixture output.** A test checks that the
  two agree, which catches authoring mistakes in either.
- **Repeat runs.** Run each example several times against the live model and report every
  run, including failures.
- **Report failure types separately:** invalid JSON, schema violation, validator rejection,
  wrong bucket, citing a distractor, following an injected instruction.
- **Near-miss distractors.** Each example has passages about the same topic but a different
  plan, scope or date. Citing one is counted as an error even if the output is structurally
  valid.

## Limitations

- Three synthetic examples, written by the people who wrote the gold labels. Small, easy to
  overfit, and not representative of real context packs.
- The validator proves a citation is real and in the right place. It cannot prove the
  passage answers the requirement.
- The prompt-injection example tests one phrasing.
- Requirement extraction is not scored.
- Provider facts are unverified (see `docs/PROVIDER.md`).

## Results

None yet.
