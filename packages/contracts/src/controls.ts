import { z } from 'zod';
import { moneySchema } from './catalog.js';

/**
 * Internal-control checklist for the owner's dashboard (BR-165, remediation R1.6): facts
 * about the company's set-up that weaken control, each with a place to fix it.
 */
export const controlsChecklistSchema = z.object({
  /** An active non-owner member holds cash custody somewhere (a treasurer exists). */
  treasurerAssigned: z.boolean(),
  /** Active members with no role at any branch (cannot work, still count as staff). */
  membersWithoutRoles: z.array(z.object({ membershipId: z.string(), fullName: z.string() })),
  /** Registers whose tolerance exceeds the company's maximum (set before the cap existed). */
  registersAboveTolerance: z.array(
    z.object({
      registerId: z.string(),
      branchId: z.string(),
      nameEn: z.string().nullable(),
      nameAr: z.string().nullable(),
      tolerance: moneySchema,
    }),
  ),
  /** Cash-outs waiting for a manager's decision on open shifts. */
  pendingCashMovements: z.number().int(),
  /** Treasury expenses and supplier payments waiting for approval (BR-166). */
  pendingPayoutRequests: z.number().int(),
  /** Cash differences with no follow-up yet (BR-167). */
  openVariances: z.number().int(),
});
export type ControlsChecklist = z.infer<typeof controlsChecklistSchema>;
