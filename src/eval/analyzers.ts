/**
 * The things the harness can score.
 *
 *  - oracle:   hand-written ideal answers. Scores 100% by construction. A sanity check on the
 *              scorer and the gold labels, NOT a result about any model.
 *  - keyword:  a naive, deterministic keyword matcher. Not a model. A floor to compare against.
 *  - live:     the real model, through the same request builder, approval-sized request and
 *              validator the app uses. The only analyzer that measures a model. Needs credentials
 *              and an explicit --yes, and is never run by default.
 */
import type { LiveSettings } from '../server/config';
import { ModelError } from '../server/model/client';
import { createLiveClient, redact } from '../server/model/meta';
import { buildChatRequest, serializeRequest } from '../server/prompt';
import { validateModelOutput } from '../server/validator';
import { compareText, deriveFacts, type Facts } from '../shared/facts';
import type { ValidationResult } from '../shared/types';
import type { ModelOutput } from '../shared/types';
import type { Analyzer, AnalyzerResult, EvalCase } from './types';

function fromValidation(checked: ValidationResult<ModelOutput>, extra: Partial<AnalyzerResult> = {}): AnalyzerResult {
  const base = { model: null, usage: null, latencyMs: null, ...extra };
  if (checked.ok) return { ...base, facts: deriveFacts(checked.value), failure: null };
  const count = checked.issues.length + checked.omitted;
  return {
    ...base,
    facts: null,
    failure: { kind: 'invalid_output', message: `Output failed validation (${count} issue${count === 1 ? '' : 's'}).`, issues: checked.issues },
  };
}

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

export const oracleAnalyzer: Analyzer = {
  id: 'oracle',
  kind: 'oracle',
  label: 'Oracle (sanity check)',
  description:
    'Returns the hand-written ideal answer for each case, so it scores 100% by construction. It shows the scorer and the gold labels agree. It says nothing about any model.',
  async run(testCase) {
    const { input, fixtureOutput } = testCase.example;
    return fromValidation(validateModelOutput(JSON.stringify(fixtureOutput), input));
  },
};

// ---------------------------------------------------------------------------
// Keyword baseline
// ---------------------------------------------------------------------------

/**
 * Fixed before any result was seen, and not tuned afterwards. A passage is "relevant" if it shares
 * at least this many content words with the task. Two passages are a "conflict" if they share at
 * least CONFLICT_MIN_SHARED non-numeric words and carry different numbers.
 */
export const KEYWORD_MIN_SHARED = 2;
export const KEYWORD_CONFLICT_MIN_SHARED = 3;

const STOPWORDS = new Set(
  (
    'a an and are as at be been but by can could do does for from had has have how if in into is it its may must of on or per ' +
    'should so than that the their them then there these they this to was were what when where which who whether will with ' +
    'within would you your after before about also any all not only other such'
  ).split(' '),
);

function contentWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const token of text.toLowerCase().match(/[a-z0-9]+(?:[.,][0-9]+)*/g) ?? []) {
    if (STOPWORDS.has(token)) continue;
    const isNumber = /^[0-9]/.test(token);
    if (!isNumber && token.length < 3) continue;
    words.add(isNumber ? token.replace(/,/g, '') : token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token);
  }
  return words;
}

const isNumber = (word: string) => /^[0-9]/.test(word);
const sharedWords = (a: Set<string>, b: Set<string>) => [...a].filter((word) => b.has(word));
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

export function keywordFacts(testCase: EvalCase): Facts {
  const { task, sources, pack } = testCase.example.input;
  const taskWords = contentWords(task);
  const inPack = new Set(pack);

  const relevant = sources
    .map((passage) => ({ id: passage.id, words: contentWords(`${passage.title} ${passage.text}`) }))
    .filter((passage) => sharedWords(passage.words, taskWords).length >= KEYWORD_MIN_SHARED);

  const conflicts: string[][] = [];
  for (let i = 0; i < relevant.length; i += 1) {
    for (let j = i + 1; j < relevant.length; j += 1) {
      const a = relevant[i]!;
      const b = relevant[j]!;
      const numbersA = new Set([...a.words].filter(isNumber));
      const numbersB = new Set([...b.words].filter(isNumber));
      const topicWords = sharedWords(a.words, b.words).filter((word) => !isNumber(word));
      if (topicWords.length >= KEYWORD_CONFLICT_MIN_SHARED && numbersA.size > 0 && numbersB.size > 0 && !sameSet(numbersA, numbersB)) {
        conflicts.push([a.id, b.id].sort());
      }
    }
  }

  const missing = relevant.filter((p) => !inPack.has(p.id)).map((p) => p.id);
  return {
    supported: relevant.filter((p) => inPack.has(p.id)).map((p) => p.id).sort(),
    missing: [...missing].sort(),
    conflicts: conflicts.sort((x, y) => compareText(x.join('|'), y.join('|'))),
    // A keyword matcher has no notion of "a question nothing answers", so it never reports one.
    unanswerable: 0,
    repairPassageIds: [...missing].sort(),
  };
}

export const keywordAnalyzer: Analyzer = {
  id: 'keyword',
  kind: 'baseline',
  label: 'Keyword baseline (not a model)',
  description:
    'A naive keyword matcher: a passage is relevant if it shares two words with the task, and two relevant passages conflict if they share a topic but carry different numbers. It never reports an unanswerable question. A floor to compare a model against, with constants fixed in advance and not tuned.',
  async run(testCase) {
    return { facts: keywordFacts(testCase), failure: null, model: null, usage: null, latencyMs: 0 };
  },
};

// ---------------------------------------------------------------------------
// Live model
// ---------------------------------------------------------------------------

/** The exact request body the live analyzer sends for a case. Used to preview and hash it before anything is sent. */
export const liveRequestBody = (settings: LiveSettings, testCase: EvalCase): string =>
  serializeRequest(buildChatRequest(testCase.example.input, settings.model, { responseFormat: settings.responseFormat }));

export interface LiveAnalyzerOptions {
  settings: LiveSettings;
  fetchImpl: typeof fetch;
  now: () => number;
  /** Called with the model's raw text (key redacted) so it can be saved for inspection. */
  onRaw?: (caseId: string, text: string) => void;
  timeoutMs?: number;
}

export function createLiveAnalyzer(options: LiveAnalyzerOptions): Analyzer {
  const { settings } = options;
  const client = createLiveClient(settings, { fetchImpl: options.fetchImpl, now: options.now, timeoutMs: options.timeoutMs });
  return {
    id: 'live',
    kind: 'model',
    label: `Live model (${settings.model})`,
    description: `Sends each case to ${settings.destination} using the same request builder and validator as the app. The only analyzer here that measures a model.`,
    async run(testCase) {
      const body = liveRequestBody(settings, testCase);
      try {
        const reply = await client.complete({ body, input: testCase.example.input });
        options.onRaw?.(testCase.id, redact(reply.text, settings.apiKey));
        return fromValidation(validateModelOutput(reply.text, testCase.example.input), {
          model: reply.model,
          usage: reply.usage,
          latencyMs: reply.latencyMs,
        });
      } catch (error) {
        const message = error instanceof ModelError || error instanceof Error ? error.message : 'Unknown error.';
        return {
          facts: null,
          failure: { kind: 'error', message: redact(message, settings.apiKey) },
          model: null,
          usage: null,
          latencyMs: null,
        };
      }
    },
  };
}
