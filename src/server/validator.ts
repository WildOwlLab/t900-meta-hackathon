/**
 * Deterministic checks on model output. No model is involved here.
 *
 * What this proves: every cited passage ID exists, every citation sits in the right
 * place for its bucket, every quote really appears in the cited passage, and every
 * repair is a selection of an existing, already-cited, not-yet-in-pack passage.
 *
 * What this does NOT prove: that a cited passage genuinely answers the requirement.
 * That judgement belongs to the model and is measured separately (docs/EVALUATION.md).
 */
import {
  AnalysisInputSchema,
  LIMITS,
  ModelOutputSchema,
  type AnalysisInput,
  type IssueCode,
  type ModelOutput,
  type Requirement,
  type ValidationIssue,
  type ValidationResult,
} from '../shared/types';

export const MAX_REPORTED_ISSUES = 50;

/**
 * Normalisation applied to BOTH the quote and the passage before the substring check:
 * Unicode NFKC, typographic quotes and dashes folded to ASCII, whitespace collapsed.
 * Matching stays case-sensitive and the quote must be one contiguous span.
 */
export function normalizeForQuote(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out ? `.${String(part)}` : String(part);
  }
  return out || '(root)';
}

function fail<T>(issues: ValidationIssue[]): ValidationResult<T> {
  return {
    ok: false,
    issues: issues.slice(0, MAX_REPORTED_ISSUES),
    omitted: Math.max(0, issues.length - MAX_REPORTED_ISSUES),
  };
}

/** Validate an analysis request (task, sources, pack). */
export function parseAnalysisInput(raw: unknown): ValidationResult<AnalysisInput> {
  const parsed = AnalysisInputSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return fail(
    parsed.error.issues.map((issue) => ({
      code: 'schema_violation' as const,
      path: formatPath(issue.path),
      message: issue.message,
    })),
  );
}

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false; issue: ValidationIssue } {
  if (raw.trim().startsWith('```')) {
    return {
      ok: false,
      issue: {
        code: 'invalid_json',
        path: '(root)',
        message: 'Output is wrapped in a Markdown code fence. Bare JSON is required.',
      },
    };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'parse error';
    return {
      ok: false,
      issue: {
        code: 'invalid_json',
        path: '(root)',
        message: `Output is not valid JSON (${reason}). Received ${raw.length} characters.`,
      },
    };
  }
}

function checkSemantics(output: ModelOutput, input: AnalysisInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: IssueCode, path: string, message: string) => issues.push({ code, path, message });

  const sourceById = new Map(input.sources.map((passage) => [passage.id, passage]));
  const packIds = new Set(input.pack);
  const normalizedText = new Map<string, string>();
  const textOf = (id: string): string => {
    let cached = normalizedText.get(id);
    if (cached === undefined) {
      cached = normalizeForQuote(sourceById.get(id)?.text ?? '');
      normalizedText.set(id, cached);
    }
    return cached;
  };

  const requirementById = new Map<string, Requirement>();

  output.requirements.forEach((requirement, i) => {
    const base = `requirements[${i}]`;

    if (requirementById.has(requirement.id)) {
      add('duplicate_requirement_id', `${base}.id`, `Requirement ID "${requirement.id}" is used more than once.`);
    } else {
      requirementById.set(requirement.id, requirement);
    }

    const knownDistinct = new Set<string>();
    requirement.evidence.forEach((evidence, j) => {
      const path = `${base}.evidence[${j}]`;
      if (!sourceById.has(evidence.passageId)) {
        add('unknown_passage_id', `${path}.passageId`, `Unknown passage ID "${evidence.passageId}".`);
        return;
      }
      knownDistinct.add(evidence.passageId);

      const quote = normalizeForQuote(evidence.quote);
      if (quote.length < LIMITS.minQuoteChars) {
        add(
          'quote_too_short',
          `${path}.quote`,
          `Quote for "${evidence.passageId}" is shorter than ${LIMITS.minQuoteChars} characters.`,
        );
      } else if (!textOf(evidence.passageId).includes(quote)) {
        add(
          'quote_not_in_passage',
          `${path}.quote`,
          `Quote is not an exact span of passage "${evidence.passageId}".`,
        );
      }

      const inPack = packIds.has(evidence.passageId);
      if (requirement.status === 'supported' && !inPack) {
        add(
          'outside_pack',
          `${path}.passageId`,
          `Requirement "${requirement.id}" is "supported" but cites "${evidence.passageId}", which is not in the pack.`,
        );
      }
      if (requirement.status === 'missing_evidence' && inPack) {
        add(
          'inside_pack',
          `${path}.passageId`,
          `Requirement "${requirement.id}" is "missing_evidence" but cites "${evidence.passageId}", which is already in the pack.`,
        );
      }
    });

    switch (requirement.status) {
      case 'supported':
      case 'missing_evidence':
        if (requirement.evidence.length === 0) {
          add('evidence_required', `${base}.evidence`, `Requirement "${requirement.id}" is "${requirement.status}" but cites no passage.`);
        }
        break;
      case 'conflicting':
        if (knownDistinct.size < 2) {
          add(
            'conflict_needs_two_passages',
            `${base}.evidence`,
            `Requirement "${requirement.id}" is "conflicting" but cites ${knownDistinct.size} distinct passage(s). At least 2 are required.`,
          );
        }
        break;
      case 'unanswerable':
        if (requirement.evidence.length > 0) {
          add('evidence_forbidden', `${base}.evidence`, `Requirement "${requirement.id}" is "unanswerable" but cites passages.`);
        }
        break;
    }
  });

  const seenRepairs = new Set<string>();
  output.repairs.forEach((repair, i) => {
    const base = `repairs[${i}]`;

    const key = `${repair.requirementId}\u0000${repair.passageId}`;
    if (seenRepairs.has(key)) {
      add('duplicate_repair', base, `Repair "${repair.requirementId}" + "${repair.passageId}" appears more than once.`);
    }
    seenRepairs.add(key);

    const requirement = requirementById.get(repair.requirementId);
    if (!requirement) {
      add('repair_unknown_requirement', `${base}.requirementId`, `Repair names unknown requirement "${repair.requirementId}".`);
    } else if (requirement.status !== 'missing_evidence' && requirement.status !== 'conflicting') {
      add(
        'repair_wrong_status',
        `${base}.requirementId`,
        `Repair targets "${requirement.id}", which is "${requirement.status}". Repairs apply only to "missing_evidence" or "conflicting".`,
      );
    }

    const known = sourceById.has(repair.passageId);
    if (!known) {
      add('unknown_passage_id', `${base}.passageId`, `Unknown passage ID "${repair.passageId}".`);
      return;
    }
    if (packIds.has(repair.passageId)) {
      add('repair_already_in_pack', `${base}.passageId`, `Passage "${repair.passageId}" is already in the pack.`);
    }
    if (requirement && !requirement.evidence.some((evidence) => evidence.passageId === repair.passageId)) {
      add(
        'repair_not_cited',
        `${base}.passageId`,
        `Passage "${repair.passageId}" is not cited as evidence for requirement "${requirement.id}".`,
      );
    }
  });

  return issues;
}

/**
 * Validate raw model output against the request it answers.
 * `raw` may be the model's text or an already-parsed value. Never throws.
 * All issues are collected (capped at MAX_REPORTED_ISSUES) rather than stopping at the first.
 */
export function validateModelOutput(raw: unknown, input: AnalysisInput): ValidationResult<ModelOutput> {
  let candidate: unknown = raw;
  if (typeof raw === 'string') {
    const parsed = parseJson(raw);
    if (!parsed.ok) return fail([parsed.issue]);
    candidate = parsed.value;
  }

  const shape = ModelOutputSchema.safeParse(candidate);
  if (!shape.success) {
    return fail(
      shape.error.issues.map((issue) => ({
        code: 'schema_violation' as const,
        path: formatPath(issue.path),
        message: issue.message,
      })),
    );
  }

  const issues = checkSemantics(shape.data, input);
  return issues.length === 0 ? { ok: true, value: shape.data } : fail(issues);
}
