import { expenseInjection } from './expense-injection';
import { refundWindow } from './refund-window';
import { retentionConflict } from './retention-conflict';
import type { Example } from './types';

export type { Example } from './types';

/** Built-in synthetic examples. All content is invented for this repository. */
export const examples: readonly Example[] = [refundWindow, retentionConflict, expenseInjection];

export function getExample(slug: string): Example | undefined {
  return examples.find((example) => example.slug === slug);
}
