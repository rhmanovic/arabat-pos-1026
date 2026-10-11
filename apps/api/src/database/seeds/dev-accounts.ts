/**
 * Fixed development-only credentials (never seeded in production). Shared with the E2E tests.
 * The TOTP secret is public on purpose: it only protects local demo data.
 */
export const DEV_PASSWORD = 'Demo-Pass-2026';
export const DEV_ACCOUNTS = {
  owner: 'owner@demo.arabat.test',
  manager: 'manager@demo.arabat.test',
  cashier: 'cashier@demo.arabat.test',
  /** Manager in "Demo Store", cashier in "Second Shop": exercises merchant selection. */
  multi: 'multi@demo.arabat.test',
  operator: 'operator@platform.arabat.test',
} as const;
export const DEV_OPERATOR_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
export const DEV_MERCHANTS = {
  demo: '01920000-0000-7000-8000-00000000d001',
  second: '01920000-0000-7000-8000-00000000d002',
} as const;
