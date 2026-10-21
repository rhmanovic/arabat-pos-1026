import type { IconName } from '@arabat/ui';

export interface NavItem {
  key: string;
  /** Line icon beside the label (ADR-0131). */
  icon: IconName;
  to: string;
  /** Shown only when the user holds one of these permissions (UX only; the API enforces). */
  anyOf: string[];
  /** False for modules not built yet: shown disabled, never as a working page. */
  available: boolean;
  /** A separate application (full page load), not a route of this app. */
  external?: boolean;
  section: 'main' | 'operations' | 'people' | 'organization';
}

export const NAV: readonly NavItem[] = [
  {
    key: 'dashboard',
    icon: 'home',
    to: '/',
    anyOf: ['manager.access'],
    available: true,
    section: 'main',
  },
  {
    key: 'account',
    icon: 'account',
    to: '/account',
    anyOf: ['manager.access'],
    available: true,
    section: 'main',
  },
  {
    key: 'products',
    icon: 'products',
    to: '/products',
    anyOf: ['catalog.read', 'catalog.manage'],
    available: true,
    section: 'operations',
  },
  {
    key: 'categories',
    icon: 'categories',
    to: '/categories',
    anyOf: ['catalog.read', 'catalog.manage'],
    available: true,
    section: 'operations',
  },
  {
    key: 'inventory',
    icon: 'inventory',
    to: '/inventory',
    anyOf: ['inventory.read'],
    available: true,
    section: 'operations',
  },
  {
    key: 'sales',
    icon: 'sales',
    to: '/sales',
    anyOf: ['sales.read'],
    available: true,
    section: 'operations',
  },
  {
    key: 'transfers',
    icon: 'transfers',
    to: '/transfers',
    anyOf: ['inventory.transfer', 'inventory.transfer.approve'],
    available: true,
    section: 'operations',
  },
  {
    key: 'refunds',
    icon: 'refunds',
    to: '/refunds',
    anyOf: ['sales.read'],
    available: true,
    section: 'operations',
  },
  {
    key: 'shifts',
    icon: 'shifts',
    to: '/shifts',
    anyOf: ['shifts.view_all'],
    available: true,
    section: 'operations',
  },
  {
    key: 'registers',
    icon: 'registers',
    to: '/registers',
    anyOf: ['registers.manage'],
    available: true,
    section: 'organization',
  },
  {
    key: 'devices',
    icon: 'devices',
    to: '/devices',
    anyOf: ['registers.manage'],
    available: true,
    section: 'organization',
  },
  {
    key: 'printers',
    icon: 'printers',
    to: '/printers',
    anyOf: ['registers.manage'],
    available: true,
    section: 'organization',
  },
  {
    key: 'cash',
    icon: 'cash',
    to: '/cash',
    anyOf: ['cash.custody'],
    available: true,
    section: 'organization',
  },
  {
    key: 'payments',
    icon: 'payments',
    to: '/payments',
    anyOf: ['payments.settings'],
    available: true,
    section: 'organization',
  },
  {
    key: 'accounts',
    icon: 'accounts',
    to: '/accounts',
    anyOf: ['payments.settings'],
    available: true,
    section: 'organization',
  },
  {
    key: 'purchasing',
    icon: 'purchasing',
    to: '/purchasing',
    anyOf: ['purchasing.read'],
    available: true,
    section: 'operations',
  },
  {
    key: 'suppliers',
    icon: 'suppliers',
    to: '/suppliers',
    anyOf: ['purchasing.read'],
    available: true,
    section: 'operations',
  },
  {
    key: 'reports',
    icon: 'reports',
    to: '/reports',
    anyOf: ['reports.sales', 'reports.financial', 'reports.inventory'],
    available: true,
    section: 'operations',
  },
  {
    key: 'restaurant',
    icon: 'restaurant',
    to: '/restaurant',
    anyOf: ['restaurant.manage'],
    available: true,
    section: 'operations',
  },
  {
    // The online store has its own console at /online (ADR-0119): same account and session.
    key: 'online',
    icon: 'orders',
    to: import.meta.env.DEV ? 'http://localhost:5178/online/' : '/online/',
    anyOf: ['online.manage', 'online.orders'],
    available: true,
    external: true,
    section: 'operations',
  },
  {
    // The link page has its own interface at /links (ADR-0116 amendment 1).
    key: 'links',
    icon: 'links',
    to: import.meta.env.DEV ? 'http://localhost:5177/links/' : '/links/',
    anyOf: ['online.manage'],
    available: true,
    external: true,
    section: 'operations',
  },
  {
    key: 'customers',
    icon: 'contact',
    to: '/customers',
    anyOf: ['customers.read'],
    available: true,
    section: 'people',
  },
  {
    key: 'employees',
    icon: 'customers',
    to: '/employees',
    anyOf: ['employees.read'],
    available: true,
    section: 'people',
  },
  {
    key: 'roles',
    icon: 'roles',
    to: '/roles',
    anyOf: ['employees.read'],
    available: true,
    section: 'people',
  },
  {
    key: 'branches',
    icon: 'branches',
    to: '/branches',
    anyOf: ['branches.read'],
    available: true,
    section: 'organization',
  },
  {
    key: 'subscription',
    icon: 'star',
    to: '/subscription',
    anyOf: ['merchant.settings.read'],
    available: true,
    section: 'organization',
  },
  {
    key: 'settings',
    icon: 'settings',
    to: '/settings',
    anyOf: ['merchant.settings.read'],
    available: true,
    section: 'organization',
  },
  {
    key: 'periods',
    icon: 'calendar',
    to: '/periods',
    anyOf: ['reports.financial'],
    available: true,
    section: 'organization',
  },
  {
    key: 'audit',
    icon: 'audit',
    to: '/audit',
    anyOf: ['audit.read'],
    available: true,
    section: 'organization',
  },
];

/**
 * Phones (ADR-0131): the first four of these the user may open sit in the bottom tab bar, with
 * "More" opening the full menu.
 */
export const TAB_KEYS = ['dashboard', 'sales', 'products', 'inventory', 'reports', 'customers'];
