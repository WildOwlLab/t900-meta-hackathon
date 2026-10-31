import type { ApiErrorBody } from '../shared/api';

/** The state of one request: not started, in flight, finished, or failed. */
export type Load<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; error: ApiErrorBody['error'] };
