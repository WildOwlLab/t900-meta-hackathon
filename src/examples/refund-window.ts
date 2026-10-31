import type { Example } from './types';

export const refundWindow: Example = {
  slug: 'refund-window',
  title: 'Annual plan refund after 45 days',
  summary:
    'A support reply that needs a refund window, a refund method, tax treatment and a bank timing. Some evidence is in the pack, some is in the sources only, and one question has no answer anywhere.',
  synthetic: true,
  input: {
    task:
      "A customer on the ExampleCo Teams annual plan asks for a refund 45 days after they bought it. Write the reply the support agent should send. It must say whether the customer is eligible, how the money would be returned, what happens to the tax that was charged, and how many days the customer's bank will take to show the refund.",
    sources: [
      {
        id: 'refund-01',
        title: 'Refund policy: annual plans',
        text: 'Annual plans: a customer may request a full refund within 30 days of the initial purchase date or of a renewal date. After 30 days the standard refund window is closed.',
      },
      {
        id: 'refund-02',
        title: 'Refund policy: payment method',
        text: 'Approved refunds are returned to the original payment method. A refund cannot be sent to a different card or bank account.',
      },
      {
        id: 'refund-03',
        title: 'Refund policy: monthly plans',
        text: 'Monthly plans: refunds are not offered for a partial month. The subscription stays active until the end of the month that was paid for.',
      },
      {
        id: 'refund-04',
        title: 'Refund exceptions: service outages',
        text: 'If a Teams annual plan was cancelled because of a verified outage longer than 24 hours, the customer may receive a prorated refund for the unused full months. The request must be made within 90 days of the outage.',
      },
      {
        id: 'refund-05',
        title: 'Refund policy: taxes',
        text: 'Sales tax and VAT that were charged on a refunded purchase are refunded in full together with the net amount.',
      },
      {
        id: 'refund-06',
        title: 'Enterprise agreements',
        text: 'Enterprise customers follow the refund terms written in their signed order form, not the standard refund policy.',
      },
      {
        id: 'refund-07',
        title: 'Support handbook: identity checks',
        text: 'Before issuing any refund, the agent must confirm that the requester is the account owner.',
      },
    ],
    pack: ['refund-01', 'refund-02', 'refund-03', 'refund-07'],
  },
  fixtureOutput: {
    requirements: [
      {
        id: 'r1',
        text: 'State the standard refund window for annual plans.',
        status: 'supported',
        evidence: [
          {
            passageId: 'refund-01',
            quote: 'a full refund within 30 days of the initial purchase date or of a renewal date',
          },
        ],
        rationale: 'The pack states a 30-day window, so a request at 45 days is outside the standard window.',
      },
      {
        id: 'r2',
        text: 'State how an approved refund is returned.',
        status: 'supported',
        evidence: [{ passageId: 'refund-02', quote: 'returned to the original payment method' }],
        rationale: 'The pack says approved refunds go back to the original payment method.',
      },
      {
        id: 'r3',
        text: 'Check whether an exception allows a refund after the standard window.',
        status: 'missing_evidence',
        evidence: [{ passageId: 'refund-04', quote: 'prorated refund for the unused full months' }],
        rationale:
          'An outage exception exists in the sources but not in the pack. The monthly plan passage in the pack does not apply to annual plans.',
      },
      {
        id: 'r4',
        text: 'State what happens to the tax charged on a refunded purchase.',
        status: 'missing_evidence',
        evidence: [{ passageId: 'refund-05', quote: 'refunded in full together with the net amount' }],
        rationale: 'The tax rule is in the sources but not in the pack.',
      },
      {
        id: 'r5',
        text: "State how many days the customer's bank takes to show the refund.",
        status: 'unanswerable',
        evidence: [],
        rationale: 'No passage mentions how long a bank takes to show a refund.',
      },
    ],
    repairs: [
      { requirementId: 'r3', passageId: 'refund-04' },
      { requirementId: 'r4', passageId: 'refund-05' },
    ],
  },
  expected: {
    supported: ['refund-01', 'refund-02'],
    missing: ['refund-04', 'refund-05'],
    conflicts: [],
    unanswerable: 1,
    repairPassageIds: ['refund-04', 'refund-05'],
  },
  distractorPassageIds: ['refund-03', 'refund-06', 'refund-07'],
  injectionPassageIds: [],
};
