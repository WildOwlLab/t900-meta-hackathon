import type { Example } from './types';

export const retentionConflict: Example = {
  slug: 'retention-conflict',
  title: 'Security questionnaire: retention conflict',
  summary:
    'A security questionnaire where all four buckets appear: backups are supported, the data region is missing from the pack, retention time is contradicted by an archived FAQ, and no independent audit report exists in the sources.',
  synthetic: true,
  input: {
    task:
      "Complete a customer's security questionnaire for ExampleCo Notes. The customer asks four things: how long deleted workspace data is kept, whether backups are encrypted, in which region customer data is stored, and whether ExampleCo has an independent security audit report.",
    sources: [
      {
        id: 'ret-01',
        title: 'Data retention policy (version 3)',
        text: 'When a workspace is deleted, its content is permanently erased from production systems within 30 days.',
      },
      {
        id: 'ret-02',
        title: 'Security overview: backups',
        text: 'All backups are encrypted at rest with AES-256.',
      },
      {
        id: 'ret-03',
        title: 'Trust center FAQ (archived)',
        text: 'Deleted workspace content is erased from all systems, including backups, within 14 days.',
      },
      {
        id: 'ret-04',
        title: 'Data retention policy: free workspaces',
        text: 'Free workspaces that are inactive for 12 months are scheduled for deletion.',
      },
      {
        id: 'ret-05',
        title: 'Data residency',
        text: 'Customer data is stored in the Frankfurt region by default. Storage in a US region is available on request.',
      },
      {
        id: 'ret-06',
        title: 'Security overview: access control',
        text: "Employees can open customer content only through an audited support tool and only with the customer's permission.",
      },
      {
        id: 'ret-07',
        title: 'Governance statement (2022)',
        text: "The board of ExampleCo approved the company's information security policy in 2022.",
      },
    ],
    pack: ['ret-01', 'ret-02', 'ret-06', 'ret-07'],
  },
  fixtureOutput: {
    requirements: [
      {
        id: 'r1',
        text: 'State how long deleted workspace data is kept.',
        status: 'conflicting',
        evidence: [
          { passageId: 'ret-01', quote: 'permanently erased from production systems within 30 days' },
          { passageId: 'ret-03', quote: 'erased from all systems, including backups, within 14 days' },
        ],
        rationale:
          'The pack says 30 days for production systems. An archived FAQ outside the pack says 14 days for all systems including backups. The sources disagree and a person needs to decide which is current.',
      },
      {
        id: 'r2',
        text: 'State whether backups are encrypted.',
        status: 'supported',
        evidence: [{ passageId: 'ret-02', quote: 'All backups are encrypted at rest with AES-256' }],
        rationale: 'The pack states that all backups are encrypted at rest.',
      },
      {
        id: 'r3',
        text: 'State the region where customer data is stored.',
        status: 'missing_evidence',
        evidence: [{ passageId: 'ret-05', quote: 'stored in the Frankfurt region by default' }],
        rationale: 'The data residency passage is in the sources but not in the pack.',
      },
      {
        id: 'r4',
        text: 'State whether ExampleCo has an independent security audit report.',
        status: 'unanswerable',
        evidence: [],
        rationale:
          'The only related passage is a board approval of an internal policy. That is not an independent audit.',
      },
    ],
    repairs: [{ requirementId: 'r3', passageId: 'ret-05' }],
  },
  expected: {
    supported: ['ret-02'],
    missing: ['ret-05'],
    conflicts: [['ret-01', 'ret-03']],
    unanswerable: 1,
    repairPassageIds: ['ret-05'],
  },
  distractorPassageIds: ['ret-04', 'ret-06', 'ret-07'],
  injectionPassageIds: [],
};
