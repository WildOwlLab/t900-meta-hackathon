/**
 * The repair engine. It SELECTS passages by ID and nothing else.
 *
 * It generates no text. Every passage added to the pack is copied from the source store by ID,
 * so the revised pack can only contain original passages, byte for byte. Only repairs that the
 * validated analysis proposed, and that the user explicitly approved, can be applied.
 */
import type { AddedPassage, RepairSelection } from '../shared/api';
import type { AnalysisInput, ModelOutput } from '../shared/types';

export type ApplyResult =
  | { ok: true; input: AnalysisInput; changed: boolean; added: AddedPassage[] }
  | { ok: false; code: 'repair_not_proposed' | 'duplicate_repair_selection'; message: string };

const keyOf = (selection: RepairSelection): string => `${selection.requirementId}\u0000${selection.passageId}`;

/**
 * Deterministic: the same inputs always give the same revised pack. The original pack order is
 * kept, and added passages follow in the order they appear in the sources.
 * `output` must already have passed the validator.
 */
export function applyRepairs(input: AnalysisInput, output: ModelOutput, approved: RepairSelection[]): ApplyResult {
  const proposed = new Set(output.repairs.map(keyOf));
  const seen = new Set<string>();

  for (const selection of approved) {
    const key = keyOf(selection);
    if (seen.has(key)) {
      return {
        ok: false,
        code: 'duplicate_repair_selection',
        message: `Repair "${selection.requirementId}" + "${selection.passageId}" was approved more than once.`,
      };
    }
    seen.add(key);
    if (!proposed.has(key)) {
      return {
        ok: false,
        code: 'repair_not_proposed',
        message: `"${selection.requirementId}" + "${selection.passageId}" is not a repair this analysis proposed.`,
      };
    }
  }

  const requirementsByPassage = new Map<string, Set<string>>();
  for (const selection of approved) {
    const set = requirementsByPassage.get(selection.passageId) ?? new Set<string>();
    set.add(selection.requirementId);
    requirementsByPassage.set(selection.passageId, set);
  }

  const inPack = new Set(input.pack);
  const added: AddedPassage[] = [];
  for (const passage of input.sources) {
    const requirements = requirementsByPassage.get(passage.id);
    if (!requirements || inPack.has(passage.id)) continue;
    added.push({
      passageId: passage.id,
      title: passage.title,
      text: passage.text,
      forRequirementIds: [...requirements].sort(),
    });
  }

  return {
    ok: true,
    changed: added.length > 0,
    added,
    input: { ...input, pack: [...input.pack, ...added.map((passage) => passage.passageId)] },
  };
}
