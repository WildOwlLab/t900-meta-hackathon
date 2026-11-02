/**
 * Contracts for the Downstream Comparison panel.
 *
 * The panel answers one question: does the repaired context pack change what a model writes for the
 * task? Two answers are produced with the SAME task and the SAME instructions. Only the context differs.
 *
 * Fixture mode never reaches the server: the browser shows hand-written text (see src/examples/downstream.ts).
 * Live mode is the only mode these endpoints serve, and it follows the same rule as analysis: the user
 * reads the exact outbound text first, and the server refuses to send anything unless the approval hash
 * matches the text it rebuilds from the request.
 *
 * This file adds to the contracts in ./api and ./types. It changes neither.
 */
import { z } from 'zod';
import { HashSchema } from './api';
import { AnalysisInputSchema, LIMITS, PassageIdSchema } from './types';

/** A live model answer is cut to this many characters before it is returned to the browser. */
export const MAX_ANSWER_CHARS = 8_000;

/** The pack ID lists must describe the same sources as `input`. The server checks that. */
const RevisedPackSchema = z.array(PassageIdSchema).max(LIMITS.maxPassages);

/**
 * Live only. In fixture mode nothing is sent anywhere, so there is nothing to preview or approve, and
 * the comparison is shown from hand-written text in the browser.
 */
export const DownstreamPreviewRequestSchema = z
  .object({
    mode: z.literal('live'),
    input: AnalysisInputSchema,
    /** The pack after the user's approved repairs: the original pack plus passages added from the sources. */
    revisedPack: RevisedPackSchema,
  })
  .strict();

export const DownstreamCompareRequestSchema = z
  .object({
    mode: z.literal('live'),
    input: AnalysisInputSchema,
    revisedPack: RevisedPackSchema,
    approvedHash: HashSchema,
  })
  .strict();

export interface DownstreamPreviewResponse {
  mode: 'live';
  sentToProvider: true;
  /** Origin and path only. */
  destination: string;
  model: string;
  /** Pack IDs for each of the two requests, in the order they appear in the prompt. */
  packs: { initial: string[]; repaired: string[] };
  /** Exactly what the user approves, and exactly what is hashed. */
  text: string;
  hashAlgorithm: 'SHA-256';
  /** SHA-256 of `text`, lowercase hex. The approval must carry this value. */
  hash: string;
}

export interface DownstreamAnswer {
  /** The passages the model was given for this answer. */
  packIds: string[];
  /** The model's text, as returned (key scrubbed, cut to MAX_ANSWER_CHARS). Not checked by T900. */
  answer: string;
  truncated: boolean;
  /** The model ID as returned by the provider, or null. */
  model: string | null;
  responseId: string | null;
  usage: unknown;
  latencyMs: number;
}

export interface DownstreamCompareResponse {
  mode: 'live';
  task: string;
  initial: DownstreamAnswer;
  repaired: DownstreamAnswer;
  meta: {
    sentToProvider: true;
    destination: string;
    approvedHash: string;
  };
}
