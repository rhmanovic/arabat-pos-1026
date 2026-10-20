import type { BranchDetail } from '@arabat/contracts';
import { localizedName, useApi, useAuth } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

export const branchesKey = ['online', 'branches'] as const;

/** Branches the user may see (server-filtered): fulfilment branch choice and order rows. */
export function useBranches(): BranchDetail[] {
  const api = useApi();
  const { hasPermission } = useAuth();
  const query = useQuery({
    queryKey: branchesKey,
    queryFn: () => api.branches.list(),
    enabled: hasPermission('branches.read'),
  });
  return query.data?.branches ?? [];
}

export function useBranchName() {
  const { i18n } = useTranslation();
  const branches = useBranches();
  return (id: string | null) => {
    if (!id) return null;
    const branch = branches.find((b) => b.id === id);
    return branch ? localizedName(branch, i18n.language) : null;
  };
}

export function useSession() {
  const { state, hasPermission } = useAuth();
  if (state.status !== 'authenticated')
    throw new Error('useSession requires an authenticated session');
  return { session: state.session, can: hasPermission };
}

/** The management app's address: same origin in production, its own port in development. */
export function managerUrl(path = ''): string {
  return `${import.meta.env.DEV ? 'http://localhost:5173/manager/' : '/manager/'}${path}`;
}

/** The link-page editor's address (ADR-0116). */
export function linksUrl(): string {
  return import.meta.env.DEV ? 'http://localhost:5177/links/' : '/links/';
}
