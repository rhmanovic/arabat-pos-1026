/**
 * Code-defined permission catalog (AUTH.md §3.4). Merchants compose these keys into
 * roles; they cannot invent new keys. Keys grow milestone by milestone.
 */
export type PermissionScope = 'merchant' | 'branch';

export interface PermissionDefinition {
  scope: PermissionScope;
  description: string;
}

export const PERMISSIONS = {
  'manager.access': { scope: 'branch', description: 'Sign in to /manager for the branch' },
  'pos.access': { scope: 'branch', description: 'Sign in to /pos at the branch' },

  'merchant.settings.read': { scope: 'merchant', description: 'View company settings' },
  'merchant.settings.update': { scope: 'merchant', description: 'Change company settings' },

  'branches.read': { scope: 'merchant', description: 'View branches' },
  'branches.create': { scope: 'merchant', description: 'Create branches' },
  'branches.update': { scope: 'merchant', description: 'Edit branches' },

  'users.read': { scope: 'merchant', description: 'View employees' },
  'users.invite': { scope: 'merchant', description: 'Invite employees' },
  'users.update': { scope: 'merchant', description: 'Edit employees' },
  'users.deactivate': { scope: 'merchant', description: 'Deactivate employees' },

  'roles.read': { scope: 'merchant', description: 'View roles' },
  'roles.manage': { scope: 'merchant', description: 'Create and edit roles' },
  'roles.assign': { scope: 'merchant', description: 'Assign roles to employees' },

  'audit.read': { scope: 'merchant', description: 'View the audit log' },
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionKey = keyof typeof PERMISSIONS;

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.hasOwn(PERMISSIONS, value);
}

export function permissionScope(key: PermissionKey): PermissionScope {
  return PERMISSIONS[key].scope;
}

/** Platform operator roles (AUTH.md §8) — a separate realm from merchant permissions. */
export const PLATFORM_ROLES = [
  'platform.super_admin',
  'platform.support',
  'platform.billing',
] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];
