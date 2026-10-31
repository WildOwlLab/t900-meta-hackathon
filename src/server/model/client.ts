import type { AnalysisInput, Mode } from '../../shared/types';

export type ModelErrorCode =
  | 'auth'
  | 'rate_limited'
  | 'timeout'
  | 'unreachable'
  | 'rejected'
  | 'upstream'
  | 'bad_response'
  | 'fixture_not_available';

/** A failure of the model call itself. The message never contains the API key. */
export class ModelError extends Error {
  constructor(
    public readonly code: ModelErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

export interface ModelCall {
  /** The exact approved HTTP body. Live mode sends this string unchanged. */
  body: string;
  /** The parsed request. Fixture mode uses it to find the matching hand-written output. */
  input: AnalysisInput;
}

export interface ModelResult {
  /** The model's text, before any validation. */
  text: string;
  /** The model ID as returned by the provider. Null in fixture mode or when not returned. */
  model: string | null;
  responseId: string | null;
  usage: unknown;
  latencyMs: number;
}

export interface ModelClient {
  readonly mode: Mode;
  complete(call: ModelCall): Promise<ModelResult>;
}
