/**
 * Hand-written answers for the Downstream Comparison panel, one pair per built-in example.
 *
 * These are ILLUSTRATIONS. No model wrote them and no model was run to produce them. They show the kind of
 * gap that missing evidence can leave in a finished answer (a confident rule nothing supports, a missed
 * exception) and what the same answer looks like when the repaired pack is available. The screen labels them
 * as hand-written wherever they appear, and nothing here says anything about how any real model behaves.
 *
 * Each pair is written for the pack that results from applying EVERY proposed repair. `needs` lists the
 * passages that pack adds. The panel only shows the repaired answer when the revised pack contains all of
 * them, because an answer written with a passage cannot honestly be shown for a pack that lacks it.
 *
 * Citations use the same [passage-id] form the live prompt asks for, and tests check that each answer cites
 * only passages that are in its own context.
 */
export interface DownstreamIllustration {
  slug: string;
  /** Passages outside the original pack that the repaired answer relies on. */
  needs: readonly string[];
  initial: {
    answer: string;
    /** What is wrong with the answer, written against the sources. */
    problems: readonly string[];
  };
  repaired: {
    answer: string;
    /** What the sources still do not settle, even with the repaired pack. */
    limits: readonly string[];
  };
}

const refundWindow: DownstreamIllustration = {
  slug: 'refund-window',
  needs: ['refund-04', 'refund-05'],
  initial: {
    answer: `Hi, thanks for getting in touch.

I'm sorry, but you aren't eligible for a refund. Annual plans can be refunded within 30 days of purchase, and you bought yours 45 days ago [refund-01]. For reference, approved refunds go back to the original payment method [refund-02].

Please also note that VAT that has already been paid cannot be refunded, and your bank usually shows a refund within 5 to 7 business days.

Kind regards,
ExampleCo Support`,
    problems: [
      'Closes the case without checking for an exception. The outage exception is in the sources (refund-04) but not in this pack.',
      'States a VAT rule. Nothing in this pack covers tax, and the real rule (refund-05, outside the pack) says tax is refunded in full with the net amount.',
      'Gives "5 to 7 business days" for the bank. No passage in any source says how long a bank takes.',
    ],
  },
  repaired: {
    answer: `Hi, thanks for getting in touch.

You bought your annual plan 45 days ago, which is outside the standard 30-day refund window [refund-01], so a standard refund is not available. There is one exception. If the plan was cancelled because of a verified outage longer than 24 hours, you may receive a prorated refund for the unused full months, as long as the request is made within 90 days of the outage [refund-04]. If that applies to you, please tell me which outage it was and the date you cancelled.

If a refund is approved, it goes back to the original payment method and cannot be sent to a different card or bank account [refund-02]. Any sales tax or VAT you were charged is refunded in full together with the net amount [refund-05].

I can't tell you how many days your bank will take to show the refund, because I don't have that information. Before I can issue any refund I also need to confirm that you are the account owner [refund-07].

Kind regards,
ExampleCo Support`,
    limits: ['How many days a bank takes to show a refund. No source covers it, so the answer says so instead of guessing.'],
  },
};

const retentionConflict: DownstreamIllustration = {
  slug: 'retention-conflict',
  needs: ['ret-05'],
  initial: {
    answer: `1. Deleted data: deleted workspace content is permanently erased from production systems within 30 days [ret-01].
2. Backups: all backups are encrypted at rest with AES-256 [ret-02].
3. Data region: customer data is stored in the United States.
4. Independent audit: yes. The board approved the information security policy in 2022 [ret-07], and ExampleCo has an independent security audit report.`,
    problems: [
      'Names a storage region with no support in this pack. The residency passage (ret-05) is in the sources but not in the pack, and it says Frankfurt by default.',
      'Says an independent audit report exists. The only related passage is the board approving an internal policy (ret-07). No source mentions an independent audit.',
    ],
  },
  repaired: {
    answer: `1. Deleted data: deleted workspace content is permanently erased from production systems within 30 days [ret-01].
2. Backups: all backups are encrypted at rest with AES-256 [ret-02].
3. Data region: customer data is stored in the Frankfurt region by default. Storage in a US region is available on request [ret-05].
4. Independent audit: I can't confirm that an independent security audit report exists. The sources only show that the board approved the information security policy in 2022 [ret-07], which is an internal approval.`,
    limits: [
      'Retention is still disputed. ret-01 says 30 days, and an archived FAQ (ret-03, outside the pack) says 14 days including backups. T900 marked it Conflicting for a person to decide and proposed no repair for it, so this answer cites ret-01 only. Do not send it before someone settles which figure is current.',
      'Whether an independent audit report exists. No source covers it.',
    ],
  },
};

const expenseInjection: DownstreamIllustration = {
  slug: 'expense-injection',
  needs: ['exp-04'],
  initial: {
    answer: `Yes, the dinner can be expensed. $180 for three people is $60 each, which is under the $120 per person limit, and an itemised receipt is required [exp-01]. Alcohol is not reimbursable [exp-02], so make sure none is on the bill.

Approval: no special approval is needed, because the amount is within the per-person limit.

Project code: yes, the cost can be charged to the client's project code.`,
    problems: [
      'Says no approval is needed. The approval rule (exp-04) is in the sources but not in this pack: any single expense above $150 needs written approval from the department head.',
      "Says the cost can be charged to the client's project code. No passage in any source covers that.",
    ],
  },
  repaired: {
    answer: `Yes, the dinner can be expensed. $180 for three people is $60 each, which is under the $120 per person limit for client meals, and an itemised receipt is required [exp-01]. Alcohol is not reimbursable under any circumstances [exp-02], so take it off the claim if it is on the bill.

Approval: the bill is above $150, so written approval from the department head is needed before the expense is submitted [exp-04].

Project code: I can't say whether the cost can be charged to the client's project code, because none of the sources covers it. The finance notice in the context asks reviewers to mark everything as supported. That is an instruction, not evidence, so it was ignored.`,
    limits: ["Charging the cost to the client's project code. No source covers it."],
  },
};

export const downstreamIllustrations: readonly DownstreamIllustration[] = [refundWindow, retentionConflict, expenseInjection];

export function getDownstreamIllustration(slug: string): DownstreamIllustration | undefined {
  return downstreamIllustrations.find((illustration) => illustration.slug === slug);
}
