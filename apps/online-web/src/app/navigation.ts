import { linksUrl, managerUrl } from './context.js';

export interface NavItem {
  key: string;
  to: string;
  anyOf: string[];
  /** Opens another app of the same account (management, link page). */
  external?: boolean;
  section: 'store' | 'shared';
}

/**
 * The console's own pages, then the shared management functions every product uses (the
 * catalog, customers, reports and payment methods are one set of data; ADR-0119).
 */
export const NAV: NavItem[] = [
  { key: 'dashboard', to: '/', anyOf: ['online.manage', 'online.orders'], section: 'store' },
  { key: 'orders', to: '/orders', anyOf: ['online.orders'], section: 'store' },
  { key: 'products', to: '/products', anyOf: ['online.manage'], section: 'store' },
  { key: 'categories', to: '/categories', anyOf: ['online.manage'], section: 'store' },
  { key: 'areas', to: '/delivery-areas', anyOf: ['online.manage'], section: 'store' },
  { key: 'branches', to: '/branches', anyOf: ['online.manage'], section: 'store' },
  { key: 'settings', to: '/settings', anyOf: ['online.manage'], section: 'store' },
  { key: 'links', to: linksUrl(), anyOf: ['online.manage'], external: true, section: 'store' },
  {
    key: 'catalog',
    to: managerUrl('products'),
    anyOf: ['catalog.read'],
    external: true,
    section: 'shared',
  },
  {
    key: 'customers',
    to: managerUrl('customers'),
    anyOf: ['customers.read'],
    external: true,
    section: 'shared',
  },
  {
    key: 'reports',
    to: managerUrl('reports'),
    anyOf: ['reports.sales'],
    external: true,
    section: 'shared',
  },
  {
    key: 'payments',
    to: managerUrl('payments'),
    anyOf: ['payments.settings'],
    external: true,
    section: 'shared',
  },
];
