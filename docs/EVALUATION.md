# Evaluation

**Status: no model has been evaluated.** The numbers below come from two analyzers that are
not models: a sanity-check oracle and a naive keyword baseline. The analyzer that measures a
real model (`live`) is built and tested against stubbed responses only. It has never been run
against a real endpoint, so this file holds no model results and the README makes no
performance claim.

## What the automated tests show

The tests cover the schema, validator, prompt builder, built-in examples, the approval gate,
the API routes, the repair engine, custom input, exports, the browser flow, the evaluation
scorer, the smoke and eval scripts' gates, and repository hygiene. They run without an
external network. The live client is tested only against stubbed provider responses written
by the tests themselves, and the browser tests use a stub provider on `127.0.0.1`.

They show that our own code behaves as designed. They show **nothing about model quality**: no
model is involved, and every fixture is a hand-written ideal output. A passing test run is not
an evaluation result.

## Rules this project holds itself to

- Every requirement lands in exactly one of four buckets: `supported`, `missing_evidence`,
  `conflicting`, `unanswerable`.
- Repairs are strict passage ID selections. The repair engine generates no text, and a
  repair that carries any text is rejected.

## Judging rubric and what we plan to show

Weights are as supplied by the project owner. This is a plan, not a claim.

| Criterion | Weight | What we plan to show |
| --- | --- | --- |
| Impact | 30% | The four-way split, which tells a user what to fix (add evidence), what to decide (resolve a conflict), and what no source can answer. Evidence: worked examples and this benchmark, including failures. |
| Use of Meta AI Tooling | 25% | A real call to the target Meta model with structured output, recorded in `docs/SMOKE.md`, with the model ID the provider returned, and a live benchmark run. |
| Technical Depth & Execution | 20% | Deterministic validation of every cited ID and quote, an approval gate on outbound text and on repairs, a reproducible benchmark with a baseline, and tests for each. |
| Demo | 25% | A fixture mode that works offline and a clearly labelled live mode, so the demo cannot fail on a network problem. |

## Running it

```bash
npm run eval                                        # oracle + keyword baseline. No network. Deterministic.
npm run eval -- --analyzer live                     # PREVIEW of a live run. Sends nothing.
npm run eval -- --analyzer live --yes               # run the real model on all 13 cases
npm run eval -- --analyzer oracle,keyword,live --yes --repeat 3
npm run eval -- --set synthetic --json results.json # only the 10 synthetic cases, and save the results
```

The live analyzer needs `META_API_KEY`, `META_API_URL` and `META_MODEL` (see `.env.example`).
It is never run by default. Without `--yes` it prints the destination, the model, how many
requests it would send and about how many tokens, and saves each exact request body under
`.eval/requests/` so you can read what would leave your machine. With `--yes` it sends the
cases one at a time, saves each raw answer under `.eval/responses/`, and scores every case,
including the ones where the model's output fails validation. `--repeat 3` runs it three times
and reports each run separately.

`npm run eval` also checks itself. If the oracle does not score perfectly, the gold labels or
the scorer are wrong, and the run stops with a non-zero exit code.

## Dataset

13 cases: the 3 built-in examples plus 10 synthetic cases in `src/eval/cases/synthetic.ts`.
Every passage ID is unique across all of them. Each case is a task, source passages, an initial
pack, a hand-written ideal output, and gold labels at the level of passage IDs.

The synthetic cases are designed to be hard in different ways: near-miss passages (a different
plan, tier, version or scope), two prompt-injection passages, an empty starting pack, a case where
the pack already answers everything (to catch false alarms), a case where nothing can be answered,
conflicts inside the pack and across the pack boundary, two conflicts in one task, and numbers that
look like conflicts but belong to different plans.

## Metrics

All scoring compares **passage IDs**. Requirement text is written by the model and cannot be matched
to a gold label, while passage IDs are stable.

Every detection rate (recall) is shown next to its precision. Recall alone can be gamed by flagging
everything, so neither is reported without the other. Counts are shown as `found/total` because the
dataset is small.

| Metric | What is counted |
| --- | --- |
| Missing evidence: recall, precision | Passages cited by `missing_evidence` requirements, against the gold set of passages that answer a requirement but are not in the pack. |
| Contradictions: recall, precision | A gold conflict is detected if a predicted `conflicting` requirement cites **all** of its passages (extra passages are allowed). One prediction can detect only one gold conflict. A predicted conflict that matches none is a false positive. |
| Conflict false alarms | Of the cases with no gold conflict, how many got a conflict reported anyway. |
| Unanswerable: recall, precision | The **number** of `unanswerable` requirements, matched by count only. This cannot tell which requirement was flagged, so it is the weakest of the four. A model that over-reports loses precision. |
| Failed outputs | Cases where the analyzer produced no valid output (invalid JSON, schema violation, or a validator rejection). A failed case gets no credit: every gold item in it counts as missed. A missing or empty `rationale` is not a failure. It plays no part in any check, so it is accepted and stored as an empty string. |

### Token and preservation metrics

Token counts are **estimates**: `ceil(characters / 4)`, not the model's tokenizer. For live runs the
provider's own usage figures are recorded in the saved results. Only the passage text is counted.

- **Required evidence** is the passages a correct answer cites: the supported ones and the missing
  ones. Passages that appear only in a conflict are **not** counted as required, because a conflict
  needs a person's decision and add-only repairs cannot resolve it. Counting them would penalise the
  ideal answer.
- **Required evidence in initial / revised pack** is the share of required passages that are in the
  pack before and after every proposed repair is applied. This assumes the user approves them all.
- **Revised pack vs all sources** is how much smaller the revised pack is than sending every source
  passage (a negative number is a smaller pack).
- **Revised pack vs initial pack** is how much the pack grew. Repairs only add passages, so this is
  never negative.
- **Dead weight** is the share of the revised pack that is irrelevant to the task: not required and
  not part of any conflict.

## Results

The block below is generated by `npm run eval -- --write-docs` and a test fails if it goes stale.
It covers the deterministic analyzers only. Do not edit it by hand.

<!-- eval:begin -->
<!-- Generated by `npm run eval -- --write-docs`. Do not edit by hand: a test fails if it goes stale. -->

**Dataset.** 13 cases (3 built-in, 10 synthetic). Gold labels: 13 missing-evidence passages, 5 conflicts, 8 unanswerable requirements. Dataset SHA-256 5d857062c889771f.

**Tokens.** Tokens are estimated as ceil(characters / 4). This is a rough heuristic, not the provider tokenizer.

### Headline metrics

| Analyzer | Missing evidence: recall | Missing evidence: precision | Contradictions: recall | Contradictions: precision | Conflict false alarms | Unanswerable: recall | Unanswerable: precision | Failed outputs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Oracle (sanity check) | 100.0% (13/13) | 100.0% (13/13) | 100.0% (5/5) | 100.0% (5/5) | 0/9 cases | 100.0% (8/8) | 100.0% (8/8) | 0/13 |
| Keyword baseline (not a model) | 84.6% (11/13) | 61.1% (11/18) | 100.0% (5/5) | 23.8% (5/21) | 4/9 cases | 0.0% (0/8) | n/a | 0/13 |

### Token and preservation metrics

| Analyzer | Required evidence in initial pack | Required evidence in revised pack | Revised pack vs all sources | Revised pack vs initial pack | Dead weight in revised pack |
| --- | --- | --- | --- | --- | --- |
| Oracle (sanity check) | 47.4% | 100.0% | -24.9% (1023/1363 tokens) | +38.2% | 38.0% (389 tokens) |
| Keyword baseline (not a model) | 47.4% | 92.3% | -18.8% (1107/1363 tokens) | +49.6% | 42.1% (466 tokens) |

### What each row is

- **Oracle (sanity check)** (sanity check, not a result): Returns the hand-written ideal answer for each case, so it scores 100% by construction. It shows the scorer and the gold labels agree. It says nothing about any model.
- **Keyword baseline (not a model)** (not a model): A naive keyword matcher: a passage is relevant if it shares two words with the task, and two relevant passages conflict if they share a topic but carry different numbers. It never reports an unanswerable question. A floor to compare a model against, with constants fixed in advance and not tuned.
- **Live model**: not run. Run it with `npm run eval -- --analyzer live` and your own credentials (see "Running it" above).
<!-- eval:end -->

### How to read this

- The oracle is perfect by construction. Its row shows only that the scorer and the gold labels
  agree, and it is the ceiling a real model is measured against.
- The keyword baseline is the floor. It is deliberately naive and its constants were fixed before any
  result was seen and are not tuned. It never reports an unanswerable question, so its unanswerable
  recall is zero by design. Beating a keyword matcher is a low bar, not a finish line.
- A real model has to do well on **both** recall and precision to be useful. Flagging conflicts that
  are not there is easy and costs the user's trust.
- **Add-only growth is by design.** Repairs only add passages, so a revised pack is always larger than
  the initial pack. What the growth buys is coverage: the revised pack holds the evidence a correct
  answer cites, and it is still smaller than sending every source passage (see "Revised pack vs all
  sources"). The size of that saving depends entirely on how many irrelevant passages the sources
  contain, and on this small dataset it is modest. The irrelevant passages already in the initial pack
  stay there, so a repair that removes passages would be needed to cut that dead weight. It is not built.
- "Coverage" means the required passages are present in the pack. It does not prove that the final
  answer written from the pack is correct.

## Limitations

- **13 cases is a smoke-level benchmark.** Rates move a lot with one case, which is why counts are
  shown. There are no confidence intervals.
- **The cases are a development set, not a held-out one.** The same authors wrote the cases, the gold
  labels, the prompt and the validator. Do not tune the prompt on these cases and then report the
  result as how the system performs on new data.
- The unanswerable metric is count-based and cannot identify which requirement was flagged.
- Requirement extraction is not scored, because the model's wording cannot be matched to a label.
- The validator requires every quote to be an exact span of its passage. A model that answers
  correctly but paraphrases a quote is counted as a failed output. That strictness is a design
  choice, and the failed-output column shows how often it bites.
- The two prompt-injection cases test two phrasings. They do not show resistance to injection in
  general.
- Token counts are an approximation.
- Provider facts are unverified (see `docs/PROVIDER.md`).
