export const platformEn = {
  title: 'Platform Administration',
  navLabel: 'Platform navigation',
  restricted: 'Restricted to platform operators',
  nav: {
    overview: 'Overview',
    merchants: 'Merchants',
    plans: 'Plans',
    operators: 'Operators',
    audit: 'Audit log',
  },
  login: {
    title: 'Operator sign-in',
    subtitle: 'Access is limited to SaaS operator staff. Two-factor authentication is required.',
  },
  overview: {
    title: 'Overview',
    emptyTitle: 'No merchants yet',
    emptyBody: 'Merchant onboarding is delivered in milestone M1.',
  },
};
export type PlatformResources = typeof platformEn;
