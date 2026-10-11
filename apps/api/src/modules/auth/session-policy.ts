import type { AppInterface } from '@arabat/contracts';

/** Per-interface session lifetimes and cookies (AUTH.md §2.1). */
export const SESSION_POLICY: Record<
  AppInterface,
  { cookie: string; idleSeconds: number; absoluteSeconds: number; sameSite: 'lax' | 'strict' }
> = {
  manager: {
    cookie: 'mgr_sid',
    idleSeconds: 60 * 60,
    absoluteSeconds: 12 * 60 * 60,
    sameSite: 'lax',
  },
  // The POS screen locks client-side after inactivity; the server session lasts a long shift.
  pos: {
    cookie: 'pos_sid',
    idleSeconds: 8 * 60 * 60,
    absoluteSeconds: 16 * 60 * 60,
    sameSite: 'lax',
  },
  platform: {
    cookie: 'plat_sid',
    idleSeconds: 15 * 60,
    absoluteSeconds: 8 * 60 * 60,
    sameSite: 'strict',
  },
};

export const COOKIE_PATH = '/api/v1';
/** last_seen_at is refreshed at most this often to avoid a write on every request. */
export const TOUCH_INTERVAL_SECONDS = 60;
export const TICKET_TTL_SECONDS = 5 * 60;
export const TICKET_MAX_ATTEMPTS = 5;
export const RESET_TOKEN_TTL_SECONDS = 30 * 60;

export const INTERFACE_HOME: Record<AppInterface, string> = {
  manager: '/manager/',
  pos: '/pos/',
  platform: '/platform/',
};
