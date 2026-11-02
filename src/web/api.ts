import type {
  AnalyzeResponse,
  ApiErrorBody,
  ApplyResponse,
  ConfigResponse,
  PreviewResponse,
  RepairSelection,
} from '../shared/api';
import type { DownstreamCompareResponse, DownstreamPreviewResponse } from '../shared/downstream';
import type { AnalysisInput, Mode, ModelOutput } from '../shared/types';

export class ApiError extends Error {
  constructor(
    public readonly detail: ApiErrorBody['error'],
    public readonly status: number,
  ) {
    super(detail.message);
    this.name = 'ApiError';
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && typeof (value as ApiErrorBody).error?.message === 'string';
}

async function request<T>(path: string, post?: unknown): Promise<T> {
  let response: Response;
  try {
    response =
      post === undefined
        ? await fetch(path)
        : await fetch(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(post),
          });
  } catch {
    throw new ApiError(
      { code: 'internal_error', message: 'Could not reach the local server. Is it running? (npm run dev:server)' },
      0,
    );
  }

  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (!response.ok) {
    throw new ApiError(
      isErrorBody(json)
        ? json.error
        : { code: 'internal_error', message: `Unexpected response from the server (HTTP ${response.status}).` },
      response.status,
    );
  }
  return json as T;
}

export const api = {
  config: () => request<ConfigResponse>('/api/config'),
  preview: (mode: Mode, input: AnalysisInput) => request<PreviewResponse>('/api/preview', { mode, input }),
  analyze: (mode: Mode, input: AnalysisInput, approvedHash: string) =>
    request<AnalyzeResponse>('/api/analyze', { mode, input, approvedHash }),
  apply: (input: AnalysisInput, analysis: ModelOutput, approvedRepairs: RepairSelection[]) =>
    request<ApplyResponse>('/api/apply', { input, analysis, approvedRepairs }),
  // Live only. Fixture comparisons are shown from hand-written text and never call the server.
  downstreamPreview: (input: AnalysisInput, revisedPack: string[]) =>
    request<DownstreamPreviewResponse>('/api/downstream-preview', { mode: 'live', input, revisedPack }),
  downstreamCompare: (input: AnalysisInput, revisedPack: string[], approvedHash: string) =>
    request<DownstreamCompareResponse>('/api/downstream-compare', { mode: 'live', input, revisedPack, approvedHash }),
};

export function toApiError(error: unknown): ApiErrorBody['error'] {
  if (error instanceof ApiError) return error.detail;
  return { code: 'internal_error', message: 'Something went wrong in the browser.' };
}
