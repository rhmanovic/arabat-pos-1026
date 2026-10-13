import type { PermissionKey } from './catalog.js';

export interface RoleTemplate {
  nameEn: string;
  nameAr: string;
  /** Typical assignment: merchant-wide or per branch (a hint for the UI, not a rule). */
  typicalScope: 'merchant' | 'branch';
  permissions: readonly PermissionKey[];
}

const POS_BASICS: PermissionKey[] = [
  'pos.access',
  'sales.create',
  'shifts.operate',
  'catalog.read',
  'customers.read',
];

/**
 * Default role templates seeded for every merchant (AUTH.md §3.5). They are ordinary,
 * editable roles; the owner is not a role (ownership implies every permission).
 * Company and branch managers do NOT get `pos.access` by default (BR-014).
 */
export const ROLE_TEMPLATES = {
  company_manager: {
    nameEn: 'Company Manager',
    nameAr: 'مدير الشركة',
    typicalScope: 'merchant',
    permissions: [
      'manager.access',
      'sales.read',
      'refunds.approve',
      'registers.manage',
      'shifts.view_all',
      'catalog.read',
      'catalog.manage',
      'catalog.prices.manage',
      'inventory.read',
      'inventory.adjust',
      'inventory.transfer',
      'inventory.transfer.approve',
      'purchasing.read',
      'purchasing.manage',
      'purchasing.approve',
      'purchasing.receive',
      'customers.read',
      'customers.create',
      'customers.manage',
      'restaurant.manage',
      'restaurant.void_item',
      'online.manage',
      'online.orders',
      'reports.sales',
      'reports.financial',
      'reports.inventory',
      'payments.settings',
      'employees.read',
      'employees.manage',
      'roles.manage',
      'branches.read',
      'branches.update',
      'branches.manage',
      'merchant.settings.read',
      'merchant.settings.update',
      'audit.read',
    ],
  },
  branch_manager: {
    nameEn: 'Branch Manager',
    nameAr: 'مدير الفرع',
    typicalScope: 'branch',
    permissions: [
      'manager.access',
      'sales.read',
      'refunds.approve',
      'registers.manage',
      'shifts.view_all',
      'catalog.read',
      'inventory.read',
      'inventory.adjust',
      'inventory.transfer',
      'purchasing.read',
      'purchasing.manage',
      'purchasing.receive',
      'customers.read',
      'customers.create',
      'customers.manage',
      'restaurant.manage',
      'restaurant.void_item',
      'online.orders',
      'reports.sales',
      'reports.inventory',
      'employees.read',
      'employees.manage',
      'branches.read',
      'branches.update',
    ],
  },
  supervisor: {
    nameEn: 'Supervisor',
    nameAr: 'مشرف',
    typicalScope: 'branch',
    permissions: [
      ...POS_BASICS,
      'sales.read',
      'sales.discount',
      'sales.discount.override_limit',
      'sales.price_override',
      'sales.void',
      'refunds.create',
      'refunds.approve',
      'shifts.view_all',
      'cash.move',
      'customers.create',
      'customers.manage',
      'inventory.read',
      'restaurant.orders',
      'restaurant.void_item',
      'kitchen.access',
    ],
  },
  cashier: {
    nameEn: 'Cashier',
    nameAr: 'كاشير',
    typicalScope: 'branch',
    permissions: [
      ...POS_BASICS,
      'sales.discount',
      'refunds.create',
      // No 'cash.move' by default (ADR-0090): the owner grants cash in/out to whom they choose.
      'customers.create',
      'restaurant.orders',
    ],
  },
  /**
   * Cash custody outside the owner (BR-165, remediation R1.6): counts treasuries and drawers,
   * moves cash between places, deposits to the bank and reads the financial reports; no selling,
   * no master data, no employee administration (least privilege).
   */
  treasurer: {
    nameEn: 'Treasurer',
    nameAr: 'أمين الخزينة',
    typicalScope: 'branch',
    permissions: [
      'manager.access',
      'cash.custody',
      'cash.deposit',
      'shifts.view_all',
      'reports.financial',
      'purchasing.read',
      'branches.read',
    ],
  },
  kitchen: {
    nameEn: 'Kitchen staff',
    nameAr: 'طاقم المطبخ',
    typicalScope: 'branch',
    permissions: ['pos.access', 'kitchen.access', 'catalog.read'],
  },
} as const satisfies Record<string, RoleTemplate>;

export type RoleTemplateKey = keyof typeof ROLE_TEMPLATES;

/** Renamed permission keys (data migration 0005 rewrites stored role permissions). */
export const RENAMED_PERMISSIONS: Record<string, PermissionKey | null> = {
  'users.read': 'employees.read',
  'users.invite': 'employees.manage',
  'users.update': 'employees.manage',
  'users.deactivate': 'employees.manage',
  'roles.read': 'employees.read',
  'roles.assign': 'employees.manage',
  'branches.create': 'branches.manage',
};
