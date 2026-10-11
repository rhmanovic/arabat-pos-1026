import type { ErrorCode, ValidationIssue } from '@arabat/contracts';

/**
 * Expected, client-facing error. Anything that is not an AppError (or a framework HTTP error)
 * is treated as an internal error and its details are never sent to the client.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly issues?: ValidationIssue[],
  ) {
    super(message);
    this.name = 'AppError';
  }

  static validation(issues: ValidationIssue[]): AppError {
    return new AppError(400, 'VALIDATION_FAILED', 'The request is invalid.', issues);
  }
  static unauthenticated(message = 'Authentication is required.'): AppError {
    return new AppError(401, 'UNAUTHENTICATED', message);
  }
  static forbidden(message = 'You do not have permission to perform this action.'): AppError {
    return new AppError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'The requested resource was not found.'): AppError {
    return new AppError(404, 'NOT_FOUND', message);
  }
  static conflict(message: string): AppError {
    return new AppError(409, 'CONFLICT', message);
  }
  static unavailable(message: string): AppError {
    return new AppError(503, 'SERVICE_UNAVAILABLE', message);
  }
}
