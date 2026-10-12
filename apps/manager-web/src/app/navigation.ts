export interface NavItem {
  key: string;
  to: string;
  /** Shown only when the user holds one of these permissions (UX only; the API enforces). */
  anyOf: string[];
  /** False for modules not built yet: shown disabled, never as a working page. */
  available: boolean;
  section: 'main' | 'operations' | 'people' | 'organization';
}

export const NAV: readonly NavItem[] = [
  { key: 'dashboard', to: '/', anyOf: ['manager.access'], available: true, section: 'main' },
  {
    key: 'products',
    to: '/products',
    anyOf: ['catalog.read', 'catalog.manage'],
    available: true,
    section: 'operations',
  },
  {
    key: 'categories',
    to: '/categories',
    anyOf: ['catalog.read', 'catalog.manage'],
    available: true,
    section: 'operations',
  },
  {
    key: 'inventory',
    to: '/inventory',
    anyOf: ['inventory.read'],
    available: true,
    section: 'operations',
  },
  { key: 'sales', to: '/sales', anyOf: ['sales.read'], available: true, section: 'operations' },
  {
    key: 'transfers',
    to: '/transfers',
    anyOf: ['inventory.transfer', 'inventory.transfer.approve'],
    available: true,
    section: 'operations',
  },
  { key: 'refunds', to: '/refunds', anyOf: ['sales.read'], available: true, section: 'operations' },
  {
    key: 'shifts',
    to: '/shifts',
    anyOf: ['shifts.view_all'],
    available: true,
    section: 'operations',
  },
  {
    key: 'registers',
    to: '/registers',
    anyOf: ['registers.manage'],
    available: true,
    section: 'organization',
  },
  {
    key: 'payments',
    to: '/payments',
    anyOf: ['payments.settings'],
    available: true,
    section: 'organization',
  },
  {
    key: 'purchasing',
    to: '/purchasing',
    anyOf: ['purchasing.read'],
    available: true,
    section: 'operations',
  },
  {
    key: 'suppliers',
    to: '/suppliers',
    anyOf: ['purchasing.read'],
    available: true,
    section: 'operations',
  },
  {
    key: 'reports',
    to: '/reports',
    anyOf: ['reports.sales', 'reports.financial', 'reports.inventory'],
    available: true,
    section: 'operations',
  },
  {
    key: 'customers',
    to: '/customers',
    anyOf: ['customers.read'],
    available: true,
    section: 'people',
  },
  {
    key: 'employees',
    to: '/employees',
    anyOf: ['employees.read'],
    available: true,
    section: 'people',
  },
  { key: 'roles', to: '/roles', anyOf: ['employees.read'], available: true, section: 'people' },
  {
    key: 'branches',
    to: '/branches',
    anyOf: ['branches.read'],
    available: true,
    section: 'organization',
  },
  {
    key: 'settings',
    to: '/settings',
    anyOf: ['merchant.settings.read'],
    available: true,
    section: 'organization',
  },
];
