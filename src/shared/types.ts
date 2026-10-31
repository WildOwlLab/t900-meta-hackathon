/**
 * Shared types and schemas for T900 Evidence Check.
 *
 * Zod schemas are the single source of truth. TypeScript types are inferred from them,
 * and the JSON Schema sent to the model is derived from the same schemas (see
 * src/server/prompt.ts), so the three cannot drift apart.
 *
 * Everything in this file is original to this repository.
 */
import { z } from 'zod';

/** Provisional caps. Revisit once the provider's context window is confirmed from official docs. */
export const LIMITS = {
  maxTaskChars: 2_000,
  maxPassages: 50,
  maxPassageChars: 4_000,
  maxTotalPassageChars: 60_000,
  maxRequirements: 25,
  maxEvidencePerRequirement: 10,
  maxRepairs: 50,
  maxRequirementTextChars: 300,
  maxRationaleChars: 600,
  maxQuoteChars: 600,
  /** Heuristic floor so a quote such as "the" cannot satisfy the substring check. */
  minQuoteChars: 8,
} as const;

/** Where a result came from. Fixture output is hand-written, never produced by a model. */
export type Mode = 'fixture' | 'live';
export const MODES = ['fixture', 'live'] as const satisfies readonly Mode[];
export const FIXTURE_NOTICE = 'Hand-written fixture. Not a model result.';

/**
 * How the expected output shape is requested from an OpenAI-compatible provider.
 *  - json_schema: the schema travels in `response_format` (default).
 *  - json_object: the provider is only asked for JSON, and the schema is written into the prompt.
 * Which one a given host accepts is unverified, so it is a server setting (META_RESPONSE_FORMAT).
 */
export const RESPONSE_FORMATS = ['json_schema', 'json_object'] as const;
export type ResponseFormatMode = (typeof RESPONSE_FORMATS)[number];

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const PASSAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,63}$/;

export const PassageIdSchema = z
  .string()
  .regex(
    PASSAGE_ID_PATTERN,
    'Passage IDs may use letters, digits and _ . : # - (max 64 characters) and must start with a letter or digit.',
  );

export const PassageSchema = z
  .object({
    id: PassageIdSchema,
    title: z.string().min(1).max(120),
    text: z.string().min(1).max(LIMITS.maxPassageChars),
  })
  .strict();
export type Passage = z.infer<typeof PassageSchema>;

/**
 * One analysis request. The context pack is a list of IDs drawn from `sources`, so
 * "in the pack" versus "available but missing from the pack" is a deterministic split
 * that the model never decides.
 */
export const AnalysisInputSchema = z
  .object({
    task: z.string().min(1).max(LIMITS.maxTaskChars),
    sources: z.array(PassageSchema).min(1).max(LIMITS.maxPassages),
    pack: z.array(PassageIdSchema).max(LIMITS.maxPassages),
  })
  .strict()
  .superRefine((input, ctx) => {
    const sourceIds = new Set<string>();
    input.sources.forEach((passage, i) => {
      if (sourceIds.has(passage.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sources', i, 'id'],
          message: `Duplicate source passage ID "${passage.id}".`,
        });
      }
      sourceIds.add(passage.id);
    });

    const packIds = new Set<string>();
    input.pack.forEach((id, i) => {
      if (packIds.has(id)) {
        ctx.addIssue({ code: 'custom', path: ['pack', i], message: `Duplicate pack entry "${id}".` });
      }
      packIds.add(id);
      if (!sourceIds.has(id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['pack', i],
          message: `Pack references unknown passage ID "${id}".`,
        });
      }
    });

    const totalChars = input.sources.reduce((sum, p) => sum + p.text.length, 0);
    if (totalChars > LIMITS.maxTotalPassageChars) {
      ctx.addIssue({
        code: 'custom',
        path: ['sources'],
        message: `Sources total ${totalChars} characters; the limit is ${LIMITS.maxTotalPassageChars}.`,
      });
    }
  });
export type AnalysisInput = z.infer<typeof AnalysisInputSchema>;

// ---------------------------------------------------------------------------
// Model output contract
// ---------------------------------------------------------------------------

/**
 * The four buckets. Every requirement gets exactly one.
 *  - supported:        the pack answers it. Cited passages are all in the pack.
 *  - missing_evidence: the pack does not, but other sources do. Cited passages are all outside the pack.
 *  - conflicting:      passages disagree. At least two distinct passages are cited.
 *  - unanswerable:     no source answers it. Nothing is cited.
 */
export const REQUIREMENT_STATUSES = ['supported', 'missing_evidence', 'conflicting', 'unanswerable'] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

// Model-facing IDs are deliberately loose here. A hallucinated ID such as "Passage 3" is
// reported by the validator as an unknown passage ID instead of a generic pattern failure.
const ModelPassageIdSchema = z.string().min(1).max(100);
const RequirementIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);

export const EvidenceSchema = z
  .object({
    passageId: ModelPassageIdSchema,
    quote: z.string().min(1).max(LIMITS.maxQuoteChars),
  })
  .strict();
export type Evidence = z.infer<typeof EvidenceSchema>;

export const RequirementSchema = z
  .object({
    id: RequirementIdSchema,
    text: z.string().min(1).max(LIMITS.maxRequirementTextChars),
    status: z.enum(REQUIREMENT_STATUSES),
    evidence: z.array(EvidenceSchema).max(LIMITS.maxEvidencePerRequirement),
    rationale: z.string().min(1).max(LIMITS.maxRationaleChars),
  })
  .strict();
export type Requirement = z.infer<typeof RequirementSchema>;

/**
 * A repair is a passage ID selection and nothing else: add this existing source passage
 * to the pack. There is deliberately no text field, so no generated text can reach the pack.
 */
export const RepairSchema = z
  .object({
    requirementId: RequirementIdSchema,
    passageId: ModelPassageIdSchema,
  })
  .strict();
export type Repair = z.infer<typeof RepairSchema>;

export const ModelOutputSchema = z
  .object({
    requirements: z.array(RequirementSchema).min(1).max(LIMITS.maxRequirements),
    repairs: z.array(RepairSchema).max(LIMITS.maxRepairs),
  })
  .strict();
export type ModelOutput = z.infer<typeof ModelOutputSchema>;

// ---------------------------------------------------------------------------
// Validation results
// ---------------------------------------------------------------------------

export const ISSUE_CODES = [
  'invalid_json',
  'schema_violation',
  'unknown_passage_id',
  'duplicate_requirement_id',
  'evidence_required',
  'evidence_forbidden',
  'outside_pack',
  'inside_pack',
  'conflict_needs_two_passages',
  'quote_too_short',
  'quote_not_in_passage',
  'repair_unknown_requirement',
  'repair_wrong_status',
  'repair_already_in_pack',
  'repair_not_cited',
  'duplicate_repair',
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

export interface ValidationIssue {
  code: IssueCode;
  /** Location in the checked document, for example `requirements[2].evidence[0].passageId`. */
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[]; /** Issues beyond the reporting cap. */ omitted: number };
