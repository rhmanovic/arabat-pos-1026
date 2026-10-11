import {
  PERMISSION_KEYS,
  type PermissionKey,
  isPermissionKey,
  permissionScope,
} from './catalog.js';

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

/** True when the permission is held at least at one branch (coarse route gate). */
export function canAnywhere(actor: MerchantActorAccess, permission: PermissionKey): boolean {
  if (!isPermissionKey(permission)) return false;
  if (!actor.membershipActive || !actor.merchantActive) return false;
  if (actor.isOwner) return true;
  const scope = permissionScope(permission);
  return actor.assignments.some(
    (a) => a.permissions.includes(permission) && (a.branchId === null || scope === 'branch'),
  );
}

export type AccessibleBranches = { all: true } | { all: false; branchIds: readonly string[] };

/** Branches the actor may see at all (any assignment), AUTH.md §3.2. */
export function accessibleBranches(actor: MerchantActorAccess): AccessibleBranches {
  if (actor.isOwner || actor.assignments.some((a) => a.branchId === null)) return { all: true };
  const ids = new Set<string>();
  for (const a of actor.assignments) if (a.branchId !== null) ids.add(a.branchId);
  return { all: false, branchIds: [...ids] };
}

/** Branches (of the given list) where the actor holds a permission. */
export function branchesWithPermission(
  actor: MerchantActorAccess,
  permission: PermissionKey,
  allBranchIds: readonly string[],
): string[] {
  return allBranchIds.filter((branchId) => can(actor, permission, branchId));
}

/** `{ all: true }` when merchant-wide, else the branch ids where the permission is held. */
export function permissionBranchScope(
  actor: MerchantActorAccess,
  permission: PermissionKey,
): AccessibleBranches {
  if (
    can(actor, permission, null) ||
    (actor.isOwner && actor.membershipActive && actor.merchantActive)
  ) {
    return { all: true };
  }
  if (permissionScope(permission) === 'merchant') return { all: false, branchIds: [] };
  const ids = actor.assignments
    .filter((a) => a.branchId !== null && a.permissions.includes(permission))
    .map((a) => a.branchId!);
  return { all: false, branchIds: [...new Set(ids)] };
}

/**
 * Anti-escalation (AUTH.md §3.6): may `actor` grant `permissions` at `branchId`
 * (null = all branches)? The actor must hold `employees.manage` there and every
 * granted permission there. Owners may grant anything.
 */
export function canGrant(
  actor: MerchantActorAccess,
  permissions: readonly string[],
  branchId: string | null,
): { ok: true } | { ok: false; missing: string[] } {
  if (actor.isOwner && actor.membershipActive && actor.merchantActive) return { ok: true };
  const missing: string[] = [];
  if (!can(actor, 'employees.manage', branchId)) missing.push('employees.manage');
  for (const p of permissions) {
    if (!isPermissionKey(p) || !can(actor, p, branchId)) missing.push(p);
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing: [...new Set(missing)] };
}

/**
 * May `actor` manage `target` (edit, deactivate, change roles)? Never the owner, never
 * oneself, and only if every grant of the target lies within the actor's authority.
 */
export function canManageMember(
  actor: MerchantActorAccess,
  target: MerchantActorAccess,
  sameMembership: boolean,
): boolean {
  if (target.isOwner || sameMembership) return false;
  if (actor.isOwner && actor.membershipActive && actor.merchantActive) return true;
  if (target.assignments.length === 0) return canAnywhere(actor, 'employees.manage');
  return target.assignments.every((a) => canGrant(actor, a.permissions, a.branchId).ok);
}

/** Merchant-wide permission keys an actor holds (used for role editing limits). */
export function merchantWidePermissions(actor: MerchantActorAccess): PermissionKey[] {
  return PERMISSION_KEYS.filter((k) => can(actor, k, null));
}
