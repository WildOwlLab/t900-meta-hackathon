/**
 * Reduce a model output to comparable, passage-ID-level facts.
 *
 * Requirement text is written by the model, so it cannot be compared to a gold label.
 * Passage IDs are stable, so evaluation compares those instead.
 */
import type { ModelOutput } from './types';

export interface Facts {
  /** Passage IDs cited by "supported" requirements, sorted and unique. */
  supported: string[];
  /** Passage IDs cited by "missing_evidence" requirements, sorted and unique. */
  missing: string[];
  /** One sorted ID set per "conflicting" requirement, the list itself sorted. */
  conflicts: string[][];
  /** Number of "unanswerable" requirements. */
  unanswerable: number;
  /** Passage IDs proposed for addition to the pack, sorted and unique. */
  repairPassageIds: string[];
}

const sortedUnique = (ids: Iterable<string>): string[] => [...new Set(ids)].sort();

export function deriveFacts(output: ModelOutput): Facts {
  const supported: string[] = [];
  const missing: string[] = [];
  const conflicts: string[][] = [];
  let unanswerable = 0;

  for (const requirement of output.requirements) {
    const ids = requirement.evidence.map((evidence) => evidence.passageId);
    switch (requirement.status) {
      case 'supported':
        supported.push(...ids);
        break;
      case 'missing_evidence':
        missing.push(...ids);
        break;
      case 'conflicting':
        conflicts.push(sortedUnique(ids));
        break;
      case 'unanswerable':
        unanswerable += 1;
        break;
    }
  }

  return {
    supported: sortedUnique(supported),
    missing: sortedUnique(missing),
    conflicts: conflicts.sort((a, b) => a.join('|').localeCompare(b.join('|'))),
    unanswerable,
    repairPassageIds: sortedUnique(output.repairs.map((repair) => repair.passageId)),
  };
}
