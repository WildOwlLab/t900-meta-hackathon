/**
 * Request and response contracts shared by the server routes and the web client.
 * Requests are zod schemas (the server validates them). Responses are plain types.
 */
import { z } from 'zod';
import {
  AnalysisInputSchema,
  LIMITS,
  MODES,
  type AnalysisInput,
  type Mode,
  type ModelOutput,
  type Repair,
  type RequirementStatus,
  type Requirement,
  type ResponseFormatMode,
  type ValidationIssue,
} from './types';

export const ModeSchema = z.enum(MODES);

/** Lowercase hex SHA-256. */
export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase hex SHA-256 hash.');

export const PreviewRequestSchema = z.object({ mode: ModeSchema, input: AnalysisInputSchema }).strict();

export const AnalyzeRequestSchema = z
  .object({ mode: ModeSchema, input: AnalysisInputSchema, approvedHash: HashSchema })
  .strict();

/** A repair the user approved: an ID pair, never text. */
export const RepairSelectionSchema = z
  .object({
    requirementId: z.string().min(1).max(32),
    passageId: z.string().min(1).max(100),
  })
  .strict();
export type RepairSelection = z.infer<typeof RepairSelectionSchema>;

export const ApplyRequestSchema = z
  .object({
    input: AnalysisInputSchema,
    /** The analysis being repaired. It is validated again against `input` on the server. */
    analysis: z.unknown(),
    approvedRepairs: z.array(RepairSelectionSchema).max(LIMITS.maxRepairs),
  })
  .strict();

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export type LiveAvailability =
  | { available: true; destination: string; model: string; responseFormat: ResponseFormatMode }
  | { available: false; reason: string };

export interface ConfigResponse {
  /** Always "fixture". Live mode is something the user chooses, never something that happens by default. */
  defaultMode: Mode;
  fixture: { available: true };
  live: LiveAvailability;
}

export interface PreviewResponse {
  mode: Mode;
  /** False in fixture mode: the text below is shown but never sent anywhere. */
  sentToProvider: boolean;
  /** Origin and path only. Null in fixture mode. */
  destination: string | null;
  /** The model that live mode would call, or null when none is configured. */
  model: string | null;
  responseFormat: ResponseFormatMode;
  /** Exactly what the user approves, and exactly what is hashed: a short header, a blank line, then `body`. */
  text: string;
  /** The exact HTTP request body. This is what live mode sends. */
  body: string;
  hashAlgorithm: 'SHA-256';
  /** SHA-256 of `text`, lowercase hex. The approval must carry this value. */
  hash: string;
}

export type Findings = Record<RequirementStatus, Requirement[]>;

export interface AnalyzeResponse {
  mode: Mode;
  /** Set in fixture mode so the result can never be mistaken for model output. */
  notice: string | null;
  findings: Findings;
  repairs: Repair[];
  /** The validated analysis. Sent back unchanged to /api/apply. */
  output: ModelOutput;
  meta: {
    sentToProvider: boolean;
    destination: string | null;
    /** The model ID as returned by the provider, or null (fixture mode, or not returned). */
    model: string | null;
    responseId: string | null;
    usage: unknown;
    latencyMs: number;
    approvedHash: string;
  };
}

export interface AddedPassage {
  passageId: string;
  title: string;
  /** Copied from the source store by ID. Never taken from model output. */
  text: string;
  forRequirementIds: string[];
}

export interface ApplyResponse {
  /** The same request with the revised pack. */
  input: AnalysisInput;
  changed: boolean;
  added: AddedPassage[];
  originalPackSize: number;
  revisedPackSize: number;
}

export type ApiErrorCode =
  | 'invalid_request'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'approval_required'
  | 'approval_mismatch'
  | 'live_unavailable'
  | 'fixture_not_available'
  | 'model_auth'
  | 'model_rate_limited'
  | 'model_timeout'
  | 'model_unreachable'
  | 'model_rejected'
  | 'model_upstream'
  | 'model_bad_response'
  | 'invalid_model_output'
  | 'invalid_analysis'
  | 'repair_not_proposed'
  | 'duplicate_repair_selection'
  | 'not_found'
  | 'internal_error';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    issues?: ValidationIssue[];
    omitted?: number;
    /** The model's text, truncated, when it failed validation. */
    rawOutput?: string;
    retryable?: boolean;
  };
}
