import type { AnalysisInput, ModelOutput } from '../../../src/shared/types';

/**
 * A custom input that the e2e specs type into the editor, and the answer the stub provider returns for it.
 * It uses the IDs and titles the editor assigns to pasted blocks (p1, p2, ... and "Passage p1", ...), with
 * passages 1, 3 and 5 ticked as "in the pack". All four buckets appear.
 *
 * A unit test checks this output against this input with the real validator, so it cannot go stale.
 */
export const customTask =
  "Answer a customer's questions about ExampleCo Cloud backups: how often they run, whether a backup can be restored into a different region, how long backups are kept, and who is allowed to trigger a restore.";

/** One pasted block per passage, in order. */
export const customBlocks = [
  'Backups run every night at 02:00 UTC.',
  'A backup can be restored only into the region where it was created.',
  'Backups are kept for 30 days.',
  'Backups are kept for 90 days.',
  'Each backup is compressed before it is stored.',
] as const;

/** Passage numbers (1-based) that the spec ticks as "in the pack". */
export const customPackNumbers = [1, 3, 5] as const;

export const customInput: AnalysisInput = {
  task: customTask,
  sources: customBlocks.map((text, index) => ({ id: `p${index + 1}`, title: `Passage p${index + 1}`, text })),
  pack: customPackNumbers.map((n) => `p${n}`),
};

export const customOutput: ModelOutput = {
  requirements: [
    {
      id: 'r1',
      text: 'State how often backups run.',
      status: 'supported',
      evidence: [{ passageId: 'p1', quote: 'Backups run every night at 02:00 UTC' }],
      rationale: 'The pack gives the schedule.',
    },
    {
      id: 'r2',
      text: 'State whether a backup can be restored into a different region.',
      status: 'missing_evidence',
      evidence: [{ passageId: 'p2', quote: 'restored only into the region where it was created' }],
      rationale: 'The restore rule is in the sources but not in the pack.',
    },
    {
      id: 'r3',
      text: 'State how long backups are kept.',
      status: 'conflicting',
      evidence: [
        { passageId: 'p3', quote: 'Backups are kept for 30 days' },
        { passageId: 'p4', quote: 'Backups are kept for 90 days' },
      ],
      rationale: 'One passage says 30 days and another says 90 days.',
    },
    {
      id: 'r4',
      text: 'State who is allowed to trigger a restore.',
      status: 'unanswerable',
      evidence: [],
      rationale: 'No passage says who can trigger a restore.',
    },
  ],
  repairs: [{ requirementId: 'r2', passageId: 'p2' }],
};
