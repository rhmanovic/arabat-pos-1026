import { OVERRIDABLE_PERMISSIONS, type OverridablePermission } from '@arabat/contracts';
import { PosRuleError } from './errors.js';

/** A supervisor's grant for one sale at one till (BR-177, `sale_overrides`). */
export interface OverrideGrant {
  status: string;
  expiresAt: Date;
  cashierMembershipId: string;
  branchId: string;
}

/**
 * A grant may be spent only while granted (single use), before it expires, by the cashier it was
 * given to and at the branch it was given for. `now` is the clock of whoever decides (the
 * database on the server, the device's clock on the device).
 */
export function assertOverrideUsable(
  grant: OverrideGrant | null | undefined,
  context: { cashierMembershipId: string; branchId: string; now: Date },
): asserts grant is OverrideGrant {
  if (
    !grant ||
    grant.status !== 'granted' ||
    !(grant.expiresAt.getTime() > context.now.getTime()) ||
    grant.cashierMembershipId !== context.cashierMembershipId ||
    grant.branchId !== context.branchId
  )
    throw new PosRuleError(
      409,
      'OVERRIDE_INVALID',
      'The supervisor approval has expired or was already used. Ask again.',
    );
}

/** A supervisor override must come from another person than the cashier. */
export function assertDifferentSupervisor(supervisorUserId: string, cashierUserId: string): void {
  if (supervisorUserId === cashierUserId)
    throw new PosRuleError(
      403,
      'OVERRIDE_SELF',
      'A supervisor override must come from another person.',
    );
}

/**
 * The rights a supervisor can lend at a till: overridable rights they hold at the branch and the
 * cashier lacks. Empty means there is nothing to authorise (`OVERRIDE_NOT_ALLOWED`).
 */
export function lendableRights(
  supervisorHolds: (permission: OverridablePermission) => boolean,
  cashierHolds: (permission: OverridablePermission) => boolean,
): OverridablePermission[] {
  return OVERRIDABLE_PERMISSIONS.filter((p) => supervisorHolds(p) && !cashierHolds(p));
}

export function assertSomethingToLend(rights: readonly OverridablePermission[]): void {
  if (rights.length === 0)
    throw new PosRuleError(
      403,
      'OVERRIDE_NOT_ALLOWED',
      'This person cannot authorise anything beyond your own rights here.',
    );
}
