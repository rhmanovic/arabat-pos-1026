import { type PermissionKey, can } from '@arabat/permissions';
import { AppError } from '../errors/app-error.js';
import type { MerchantActor } from './session-resolver.js';

/** Fine-grained check inside services (the route guard is only a coarse gate). */
export function assertCan(
  actor: MerchantActor,
  permission: PermissionKey,
  branchId: string | null,
): void {
  if (!can(actor.access, permission, branchId)) throw AppError.forbidden();
}
