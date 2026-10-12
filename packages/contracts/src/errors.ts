import { z } from 'zod';

/** Stable, machine-readable error codes returned in RFC 9457 problem responses. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'MALFORMED_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'ROUTE_NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
  // Authentication (AUTH.md). Sign-in errors never reveal whether an account exists.
  'INVALID_CREDENTIALS',
  'ACCOUNT_DISABLED',
  'NO_MERCHANT_ACCESS',
  'INTERFACE_NOT_PERMITTED',
  'TICKET_INVALID',
  'MFA_INVALID',
  'RESET_TOKEN_INVALID',
  'EMAIL_ALREADY_REGISTERED',
  'ORIGIN_REJECTED',
  'VERSION_CONFLICT',
  'PRIVILEGE_ESCALATION',
  'INVITATION_INVALID',
  'ROLE_IN_USE',
  'BRANCH_REQUIRED',
  'DUPLICATE_CODE',
  'ALREADY_MEMBER',
  'DUPLICATE_SKU',
  'DUPLICATE_BARCODE',
  'INVALID_PRICE',
  'UNSUPPORTED_MEDIA',
  'INSUFFICIENT_STOCK',
  'NOT_STOCK_TRACKED',
  'OPENING_STOCK_EXISTS',
  'INVALID_QUANTITY',
  'IDEMPOTENCY_CONFLICT',
  'BRANCH_INACTIVE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const validationIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

/** RFC 9457 problem details as returned by the API (`application/problem+json`). */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
  issues: z.array(validationIssueSchema).optional(),
  /** Interfaces the user may use instead (with INTERFACE_NOT_PERMITTED). */
  availableInterfaces: z.array(z.enum(['manager', 'pos'])).optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
