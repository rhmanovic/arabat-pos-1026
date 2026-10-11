import type { BranchDetail } from '@arabat/contracts';
import { localizedName, useApi, useAuth } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, createContext, useContext, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const STORAGE_KEY = 'arabat.manager.branch';

interface BranchContextValue {
  /** Selected branch id, or null for "all accessible branches". */
  branchId: string | null;
  setBranchId: (id: string | null) => void;
  branches: BranchDetail[];
  isLoading: boolean;
}

const BranchContext = createContext<BranchContextValue | null>(null);

export const branchesKey = ['manager', 'branches'] as const;

/** Branches visible to the user (server-filtered) and the branch the manager is working in. */
export function BranchContextProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const { hasPermission } = useAuth();
  const query = useQuery({
    queryKey: branchesKey,
    queryFn: () => api.branches.list(),
    enabled: hasPermission('branches.read'),
  });
  const [stored, setStored] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const branches = useMemo(() => query.data?.branches ?? [], [query.data]);
  // Ignore a stored branch that is no longer accessible.
  const branchId = stored && branches.some((b) => b.id === stored) ? stored : null;
  const value = useMemo<BranchContextValue>(
    () => ({
      branchId,
      branches,
      isLoading: query.isPending && hasPermission('branches.read'),
      setBranchId: (id) => {
        setStored(id);
        try {
          if (id) localStorage.setItem(STORAGE_KEY, id);
          else localStorage.removeItem(STORAGE_KEY);
        } catch {
          // Storage unavailable: the choice lasts for this page only.
        }
      },
    }),
    [branchId, branches, query.isPending, hasPermission],
  );
  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranchContext(): BranchContextValue {
  const value = useContext(BranchContext);
  if (!value) throw new Error('useBranchContext must be used inside <BranchContextProvider>');
  return value;
}

export function useBranchName() {
  const { i18n } = useTranslation();
  const { branches } = useBranchContext();
  return (id: string | null) => {
    if (!id) return null;
    const branch = branches.find((b) => b.id === id);
    return branch ? localizedName(branch, i18n.language) : null;
  };
}

/** Permission labels contain dots, so they are looked up from the `perm` object. */
export function usePermissionLabel() {
  const { t } = useTranslation();
  const labels = t('perm', { returnObjects: true }) as Record<string, string>;
  return (key: string) => labels[key] ?? key;
}

export function useSession() {
  const { state, hasPermission } = useAuth();
  if (state.status !== 'authenticated')
    throw new Error('useSession requires an authenticated session');
  return { session: state.session, can: hasPermission };
}
