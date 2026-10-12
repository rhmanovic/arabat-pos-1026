import type { PlatformRole } from '@arabat/permissions';
import { formatDateTime } from '@arabat/i18n';
import { useAuth } from '@arabat/web-core';
import { useTranslation } from 'react-i18next';

export const platformKey = ['platform'] as const;

/** The operator's role (UX only; the API enforces every action). */
export function useRole(): {
  role: PlatformRole | null;
  can: (...roles: PlatformRole[]) => boolean;
} {
  const { state } = useAuth();
  const role =
    state.status === 'authenticated'
      ? ((state.session.permissions[0] ?? null) as PlatformRole | null)
      : null;
  return { role, can: (...roles) => role !== null && roles.includes(role) };
}

export function useFormat() {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith('ar');
  return {
    date: (iso: string | null | undefined) => (iso ? formatDateTime(iso, i18n.language) : '—'),
    name: (x: { nameEn: string | null; nameAr: string | null }) =>
      (ar ? x.nameAr || x.nameEn : x.nameEn || x.nameAr) ?? '—',
    planName: (x: { nameEn: string; nameAr: string }) => (ar ? x.nameAr : x.nameEn),
  };
}

export const MERCHANT_TONE = {
  active: 'success',
  suspended: 'warning',
  closed: 'neutral',
} as const;
export const SUB_TONE = {
  trialing: 'primary',
  active: 'success',
  past_due: 'warning',
  cancelled: 'neutral',
  expired: 'danger',
  trial_ended: 'warning',
} as const;
