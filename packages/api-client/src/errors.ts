import { type ProblemDetails, problemDetailsSchema } from '@arabat/contracts';

/** An error response from the API, parsed from RFC 9457 problem details. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problem: ProblemDetails;

  constructor(problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
    this.status = problem.status;
    this.code = problem.code;
    this.problem = problem;
  }

  get requestId(): string | undefined {
    return this.problem.requestId;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

/** The API could not be reached (offline, DNS, CORS, server down). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('The server could not be reached.', { cause });
    this.name = 'NetworkError';
  }
}

/** The API answered with a body that does not match the expected contract. */
export class ContractError extends Error {
  constructor(path: string, cause: unknown) {
    super(`Unexpected response shape from ${path}`, { cause });
    this.name = 'ContractError';
  }
}

export async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const parsed = problemDetailsSchema.safeParse(body);
  if (parsed.success) return new ApiError(parsed.data);
  return new ApiError({
    type: 'about:blank',
    title: response.statusText || 'Request failed',
    status: response.status,
    code: response.status >= 500 ? 'INTERNAL_ERROR' : 'MALFORMED_REQUEST',
  });
}
