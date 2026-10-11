/** Shared English strings used by all three applications (namespace "common"). */
export const commonEn = {
  appName: 'Arabat POS',
  interfaces: {
    manager: 'Manager',
    pos: 'Point of Sale',
    platform: 'Platform Administration',
  },
  language: {
    label: 'Language',
    ar: 'العربية',
    en: 'English',
  },
  actions: {
    retry: 'Try again',
    signIn: 'Sign in',
    signOut: 'Sign out',
    back: 'Back',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
  },
  status: {
    loading: 'Loading…',
    apiOnline: 'Server connected',
    apiDegraded: 'Server degraded',
    apiOffline: 'Server unreachable',
    apiChecking: 'Checking server…',
  },
  auth: {
    email: 'Email',
    password: 'Password',
    signInUnavailableTitle: 'Sign-in is not available yet',
    signInUnavailableBody:
      'User accounts and sessions are delivered in milestone M1. Until then every protected page is locked.',
    accessDenied: 'You do not have permission to view this page.',
  },
  nav: {
    comingSoon: 'Coming in {{milestone}}',
  },
  errors: {
    title: 'Something went wrong',
    notFoundTitle: 'Page not found',
    notFoundBody: 'The page you are looking for does not exist.',
    requestId: 'Reference: {{id}}',
    UNAUTHENTICATED: 'Please sign in to continue.',
    FORBIDDEN: 'You do not have permission to perform this action.',
    VALIDATION_FAILED: 'Some fields are invalid. Please review them.',
    NOT_FOUND: 'The requested item was not found.',
    ROUTE_NOT_FOUND: 'The requested address does not exist.',
    CONFLICT: 'This record was changed by someone else. Reload and try again.',
    RATE_LIMITED: 'Too many attempts. Please wait and try again.',
    SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
    NETWORK: 'Cannot reach the server. Check your connection.',
    UNKNOWN: 'An unexpected error occurred.',
  },
};

export type CommonResources = typeof commonEn;
