import type { PermissionKey } from './catalog.js';

export interface RoleTemplate {
  nameEn: string;
  nameAr: string;
  permissions: readonly PermissionKey[];
}

/**
 * System role templates seeded for every new merchant (AUTH.md §3.5). The owner is not a
 * role: ownership implies every permission. Merchants may edit these roles later (M1 roles UI).
 * Manager does NOT include `pos.access` and Cashier does NOT include `manager.access`
 * (BR-013, BR-014): POS access for a manager must be granted explicitly.
 */
export const ROLE_TEMPLATES = {
  manager: {
    nameEn: 'Manager',
    nameAr: 'مدير',
    permissions: [
      'manager.access',
      'merchant.settings.read',
      'branches.read',
      'users.read',
      'roles.read',
      'audit.read',
    ],
  },
  cashier: {
    nameEn: 'Cashier',
    nameAr: 'كاشير',
    permissions: ['pos.access'],
  },
} as const satisfies Record<string, RoleTemplate>;

export type RoleTemplateKey = keyof typeof ROLE_TEMPLATES;
