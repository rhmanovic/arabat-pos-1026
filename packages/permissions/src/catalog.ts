/**
 * Code-defined permission catalog (AUTH.md §3.4). Merchants compose these keys into
 * roles; they cannot invent new keys.
 *
 * Scope:
 * - `merchant`: only granted by a merchant-wide assignment (branch_id NULL).
 * - `branch`: granted per branch; a merchant-wide assignment grants it at every branch.
 */
export type PermissionScope = 'merchant' | 'branch';

export type PermissionGroup =
  | 'access'
  | 'sales'
  | 'refunds'
  | 'registers'
  | 'catalog'
  | 'inventory'
  | 'purchasing'
  | 'customers'
  | 'restaurant'
  | 'online'
  | 'reports'
  | 'payments'
  | 'employees'
  | 'branches'
  | 'company';

export interface PermissionDefinition {
  scope: PermissionScope;
  group: PermissionGroup;
  description: string;
}

export const PERMISSIONS = {
  // Interface access (BR-013, BR-014)
  'manager.access': {
    scope: 'branch',
    group: 'access',
    description: 'Use the management app for the branch',
  },
  'pos.access': { scope: 'branch', group: 'access', description: 'Use the POS at the branch' },

  // Sales
  'sales.create': { scope: 'branch', group: 'sales', description: 'Create sales at the POS' },
  'sales.read': { scope: 'branch', group: 'sales', description: 'View sales history' },
  'sales.discount': {
    scope: 'branch',
    group: 'sales',
    description: 'Apply discounts within the allowed limit',
  },
  'sales.discount.override_limit': {
    scope: 'branch',
    group: 'sales',
    description: 'Apply discounts above the limit',
  },
  'sales.price_override': {
    scope: 'branch',
    group: 'sales',
    description: 'Change the selling price of an item',
  },
  'sales.void': {
    scope: 'branch',
    group: 'sales',
    description: 'Cancel an open or same-shift sale',
  },

  // Refunds
  'refunds.create': {
    scope: 'branch',
    group: 'refunds',
    description: 'Process returns and refunds',
  },
  'refunds.approve': {
    scope: 'branch',
    group: 'refunds',
    description: 'Approve restricted refunds',
  },

  // Registers and shifts
  'registers.manage': { scope: 'branch', group: 'registers', description: 'Configure registers' },
  'shifts.operate': {
    scope: 'branch',
    group: 'registers',
    description: 'Open and close own shift',
  },
  'shifts.view_all': { scope: 'branch', group: 'registers', description: 'Monitor all shifts' },
  'cash.move': { scope: 'branch', group: 'registers', description: 'Record cash in / cash out' },
  'cash.custody': {
    scope: 'branch',
    group: 'registers',
    description:
      'Manage cash custody: treasury counts, transfers between registers and the treasury',
  },
  'cash.deposit': {
    scope: 'branch',
    group: 'registers',
    description: 'Deposit cash from a register or treasury into a bank account',
  },

  // Catalog
  'catalog.read': {
    scope: 'branch',
    group: 'catalog',
    description: 'View products and categories',
  },
  'catalog.manage': {
    scope: 'merchant',
    group: 'catalog',
    description: 'Create and edit products and categories',
  },
  'catalog.prices.manage': {
    scope: 'merchant',
    group: 'catalog',
    description: 'Change prices and costs',
  },

  // Inventory
  'inventory.read': { scope: 'branch', group: 'inventory', description: 'View stock' },
  'inventory.adjust': { scope: 'branch', group: 'inventory', description: 'Adjust stock' },
  'inventory.transfer': {
    scope: 'branch',
    group: 'inventory',
    description: 'Request, dispatch and receive transfers',
  },
  'inventory.transfer.approve': {
    scope: 'branch',
    group: 'inventory',
    description: 'Approve transfers',
  },

  // Purchasing
  'purchasing.read': {
    scope: 'branch',
    group: 'purchasing',
    description: 'View suppliers and purchase orders',
  },
  'purchasing.manage': {
    scope: 'branch',
    group: 'purchasing',
    description: 'Create purchase orders and suppliers',
  },
  'purchasing.approve': {
    scope: 'branch',
    group: 'purchasing',
    description: 'Approve purchase orders',
  },
  'purchasing.receive': { scope: 'branch', group: 'purchasing', description: 'Receive goods' },

  // Customers
  'customers.read': {
    scope: 'branch',
    group: 'customers',
    description: 'Search and view customers',
  },
  'customers.create': {
    scope: 'branch',
    group: 'customers',
    description: 'Create basic customer profiles',
  },
  'customers.manage': {
    scope: 'branch',
    group: 'customers',
    description: 'Edit customers, notes and status',
  },

  // Restaurant (Prompt 15)
  'restaurant.manage': {
    scope: 'branch',
    group: 'restaurant',
    description: 'Configure menu modifiers, recipes, tables and kitchen stations',
  },
  'restaurant.orders': {
    scope: 'branch',
    group: 'restaurant',
    description: 'Take dine-in, takeaway and pickup orders',
  },
  'restaurant.void_item': {
    scope: 'branch',
    group: 'restaurant',
    description: 'Cancel items already sent to the kitchen',
  },
  'kitchen.access': {
    scope: 'branch',
    group: 'restaurant',
    description: 'Use the kitchen display',
  },

  // Online store (Prompt 16)
  'online.manage': {
    scope: 'merchant',
    group: 'online',
    description: 'Configure the online store, listings and online payment methods',
  },
  'online.orders': {
    scope: 'branch',
    group: 'online',
    description: 'View and fulfil online orders',
  },

  // Reports
  'reports.sales': { scope: 'branch', group: 'reports', description: 'Sales reports' },
  'reports.financial': {
    scope: 'branch',
    group: 'reports',
    description: 'Payments, cash and financial reports',
  },
  'reports.inventory': {
    scope: 'branch',
    group: 'reports',
    description: 'Inventory reports and valuation',
  },

  // Payment settings
  'payments.settings': {
    scope: 'merchant',
    group: 'payments',
    description: 'Configure payment methods and fees',
  },

  // Employee administration (branch-scoped: a branch manager manages their branch staff)
  'employees.read': { scope: 'branch', group: 'employees', description: 'View employees' },
  'employees.manage': {
    scope: 'branch',
    group: 'employees',
    description: 'Invite, edit, (de)activate and assign employees',
  },
  'roles.manage': { scope: 'merchant', group: 'employees', description: 'Create and edit roles' },

  // Branch administration
  'branches.read': { scope: 'branch', group: 'branches', description: 'View branch information' },
  'branches.update': {
    scope: 'branch',
    group: 'branches',
    description: 'Edit branch information and settings',
  },
  'branches.manage': {
    scope: 'merchant',
    group: 'branches',
    description: 'Create, activate and deactivate branches',
  },

  // Company
  'merchant.settings.read': {
    scope: 'merchant',
    group: 'company',
    description: 'View company settings',
  },
  'merchant.settings.update': {
    scope: 'merchant',
    group: 'company',
    description: 'Change company settings',
  },
  'audit.read': { scope: 'merchant', group: 'company', description: 'View the audit log' },
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionKey = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

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
