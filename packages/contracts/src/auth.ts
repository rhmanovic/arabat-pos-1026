import { z } from 'zod';
import { appInterfaceSchema } from './interfaces.js';

/**
 * Response of `GET /api/v1/auth/{interface}/me`: the authenticated session of that interface.
 * Session issuing (login) arrives in milestone M1; until then the endpoint answers 401.
 * Profile and merchant details are added to this contract in M1. The frontend uses
 * `permissions` only to hide UI; the backend remains the authority.
 */
export const meResponseSchema = z.object({
  interface: appInterfaceSchema,
  realm: z.enum(['merchant', 'platform']),
  actorId: z.string(),
  merchantId: z.string().nullable(),
  boundBranchId: z.string().nullable(),
  /** Owner: every key. Otherwise the union of granted keys; branch scoping is enforced server-side. */
  permissions: z.array(z.string()),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
