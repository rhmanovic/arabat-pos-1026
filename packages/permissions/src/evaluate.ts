import { type PermissionKey, isPermissionKey, permissionScope } from './catalog.js';

/** A role assignment: role permissions granted at one branch, or all branches when null. */
export interface RoleAssignmentGrant {
  branchId: string | null;
  permissions: readonly string[];
}

export interface MerchantActorAccess {
  membershipActive: boolean;
  merchantActive: boolean;
  isOwner: boolean;
  assignments: readonly RoleAssignmentGrant[];
}

/**
 * Evaluates a permission for a merchant actor (AUTH.md §3.2). Default is deny:
 * unknown keys, inactive memberships, suspended merchants and missing branch
 * context all return false.
 */
export function can(
  actor: MerchantActorAccess,
  permission: PermissionKey,
  branchId?: string | null,
): boolean {
  if (!isPermissionKey(permission)) return false;
  if (!actor.membershipActive || !actor.merchantActive) return false;
  if (actor.isOwner) return true;

  const scope = permissionScope(permission);
  return actor.assignments.some((assignment) => {
    if (!assignment.permissions.includes(permission)) return false;
    if (assignment.branchId === null) return true;
    if (scope === 'merchant') return false;
    return branchId != null && assignment.branchId === branchId;
  });
}

export type AccessibleBranches = { all: true } | { all: false; branchIds: readonly string[] };

/** Branches the actor may see at all (any assignment), AUTH.md §3.2. */
export function accessibleBranches(actor: MerchantActorAccess): AccessibleBranches {
  if (actor.isOwner || actor.assignments.some((a) => a.branchId === null)) return { all: true };
  const ids = new Set<string>();
  for (const a of actor.assignments) if (a.branchId !== null) ids.add(a.branchId);
  return { all: false, branchIds: [...ids] };
}

/** Branches where the actor holds a branch-scoped permission (e.g. `pos.access`). */
export function branchesWithPermission(
  actor: MerchantActorAccess,
  permission: PermissionKey,
  allBranchIds: readonly string[],
): string[] {
  return allBranchIds.filter((branchId) => can(actor, permission, branchId));
}
