import { z } from 'zod';

/**
 * Merchant-facing audit trail (BR-163, remediation R1 / FND-101): the company's own
 * append-only events, readable by holders of `audit.read`. Platform-only events never appear.
 */
export const AUDIT_ACTOR_TYPES = ['user', 'operator', 'system', 'anonymous'] as const;

export const auditEntrySchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  actorType: z.enum(AUDIT_ACTOR_TYPES),
  actorId: z.string().nullable(),
  /** Full name of the employee; null for system, anonymous and platform actors. */
  actorName: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  ip: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const auditListQuerySchema = z.object({
  /** Local days of the merchant (inclusive). */
  from: z.string().regex(DATE).optional(),
  to: z.string().regex(DATE).optional(),
  /** Substring of the action key (e.g. "refund", "shift.force_closed"). */
  action: optionalText(60),
  targetType: optionalText(40),
  actorId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditListQuery = z.input<typeof auditListQuerySchema>;

export const auditListSchema = z.object({
  entries: z.array(auditEntrySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** Distinct action keys of the company, for the filter. */
  actions: z.array(z.string()),
});
export type AuditList = z.infer<typeof auditListSchema>;
