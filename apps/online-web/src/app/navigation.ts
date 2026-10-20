import { linksUrl, managerUrl } from './context.js';
import type { IconName } from './icons.js';

export interface NavItem {
  key: string;
  to: string;
  anyOf: string[];
  /** Opens another app of the same account (management, link page). */
  external?: boolean;
  section: 'store' | 'shared';
  icon: IconName;
  /** Shown in the phone's bottom tab bar. */
  tab?: boolean;
}

/**
 * The console's own pages, then the shared management functions every product uses (the
 * catalog, customers, reports and payment methods are one set of data; ADR-0119).
 */
export const NAV: NavItem[] = [
  {
    key: 'dashboard',
    icon: 'home',
    tab: true,
    to: '/',
    anyOf: ['online.manage', 'online.orders'],
    section: 'store',
  },
  {
    key: 'orders',
    icon: 'orders',
    tab: true,
    to: '/orders',
    anyOf: ['online.orders'],
    section: 'store',
  },
  {
    key: 'products',
    icon: 'products',
    tab: true,
    to: '/products',
    anyOf: ['online.manage'],
    section: 'store',
  },
  {
    key: 'categories',
    icon: 'categories',
    to: '/categories',
    anyOf: ['online.manage'],
    section: 'store',
  },
  {
    key: 'areas',
    icon: 'areas',
    to: '/delivery-areas',
    anyOf: ['online.manage'],
    section: 'store',
  },
  {
    key: 'branches',
    icon: 'branches',
    to: '/branches',
    anyOf: ['online.manage'],
    section: 'store',
  },
  {
    key: 'promotions',
    icon: 'promotions',
    tab: true,
    to: '/promotions',
    anyOf: ['online.manage'],
    section: 'store',
  },
  {
    key: 'analytics',
    icon: 'analytics',
    to: '/analytics',
    anyOf: ['online.manage', 'online.orders'],
    section: 'store',
  },
  { key: 'design', icon: 'design', to: '/design', anyOf: ['online.manage'], section: 'store' },
  {
    key: 'settings',
    icon: 'settings',
    to: '/settings',
    anyOf: ['online.manage'],
    section: 'store',
  },
  {
    key: 'links',
    icon: 'links',
    to: linksUrl(),
    anyOf: ['online.manage'],
    external: true,
    section: 'store',
  },
  {
    key: 'catalog',
    icon: 'catalog',
    to: managerUrl('products'),
    anyOf: ['catalog.read'],
    external: true,
    section: 'shared',
  },
  {
    key: 'customers',
    icon: 'customers',
    to: managerUrl('customers'),
    anyOf: ['customers.read'],
    external: true,
    section: 'shared',
  },
  {
    key: 'reports',
    icon: 'reports',
    to: managerUrl('reports'),
    anyOf: ['reports.sales'],
    external: true,
    section: 'shared',
  },
  {
    key: 'payments',
    icon: 'payments',
    to: managerUrl('payments'),
    anyOf: ['payments.settings'],
    external: true,
    section: 'shared',
  },
];
