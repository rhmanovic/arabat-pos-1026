import type { ErrorCode, ValidationIssue } from '@arabat/contracts';

/**
 * A selling rule refused the input. `status` is the HTTP status the API answers with, so the
 * server and the device report the same refusal; the device shows `code` and `message`.
 */
export class PosRuleError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly issues?: ValidationIssue[],
  ) {
    super(message);
    this.name = 'PosRuleError';
  }

  /** Same shape as the API's generic validation failure. */
  static validation(issues: ValidationIssue[]): PosRuleError {
    return new PosRuleError(400, 'VALIDATION_FAILED', 'The request is invalid.', issues);
  }
}
