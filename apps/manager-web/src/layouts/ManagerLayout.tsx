import { Badge, Button, cn } from '@arabat/ui';
import {
  ApiStatus,
  BranchList,
  LanguageSwitcher,
  localizedName,
  useAuth,
  useLogout,
  useSwitchInterface,
} from '@arabat/web-core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';

interface NavItem {
  key: string;
  to?: string;
  /** Milestone in which the section becomes available (shown disabled until then). */
  milestone?: string;
}

const NAV: readonly NavItem[] = [
  { key: 'dashboard', to: '/' },
  { key: 'branches', milestone: 'M1' },
  { key: 'staff', milestone: 'M1' },
  { key: 'roles', milestone: 'M1' },
  { key: 'products', milestone: 'M2' },
  { key: 'inventory', milestone: 'M3' },
  { key: 'sales', milestone: 'M4' },
  { key: 'reports', milestone: 'M7' },
  { key: 'settings', milestone: 'M1' },
];

/** Desktop-first management shell: sidebar on the start side, top bar, content area. */
export function ManagerLayout() {
  const { t, i18n } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { state } = useAuth();
  const logout = useLogout('manager');
  const switchToPos = useSwitchInterface('manager');
  const session = state.status === 'authenticated' ? state.session : null;
  const branchChoice =
    switchToPos.data?.status === 'select_branch' ? switchToPos.data.branches : null;

  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[16rem_1fr]">
      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-40 w-64 border-e border-border bg-surface transition-transform lg:static',
          // Off-canvas on small screens; slides in from the start side in both directions.
          !menuOpen && 'max-lg:ltr:-translate-x-full max-lg:rtl:translate-x-full',
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-border px-5">
          <span className="grid size-8 place-items-center rounded-md bg-primary text-sm font-bold text-primary-fg">
            ع
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">{t('common:appName')}</p>
            <p className="text-xs text-fg-muted">{t('title')}</p>
          </div>
        </div>
        <nav aria-label={t('navLabel')} className="flex flex-col gap-0.5 p-3">
          {NAV.map((item) =>
            item.to ? (
              <NavLink
                key={item.key}
                to={item.to}
                end
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-2 text-sm font-medium',
                    isActive ? 'bg-primary-soft text-primary' : 'text-fg hover:bg-surface-muted',
                  )
                }
              >
                {t(`nav.${item.key}`)}
              </NavLink>
            ) : (
              <span
                key={item.key}
                aria-disabled="true"
                className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-fg-subtle"
              >
                {t(`nav.${item.key}`)}
                <Badge>{t('common:nav.comingSoon', { milestone: item.milestone })}</Badge>
              </span>
            ),
          )}
        </nav>
      </aside>

      {menuOpen ? (
        <button
          type="button"
          aria-label={t('common:actions.closeMenu')}
          className="fixed inset-0 z-30 bg-fg/30 lg:hidden"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={t('common:actions.openMenu')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </Button>
          <div className="min-w-0 flex-1">
            {session?.merchant ? (
              <p className="truncate text-sm font-semibold" data-testid="merchant-name">
                {localizedName(session.merchant, i18n.language)}
              </p>
            ) : null}
          </div>
          <ApiStatus className="hidden xl:inline-flex" />
          {session?.availableInterfaces.includes('pos') ? (
            <Button
              variant="secondary"
              size="sm"
              loading={switchToPos.isPending}
              onClick={() => switchToPos.mutate({ target: 'pos' })}
            >
              {t('common:auth.switchTo', { app: t('common:interfaces.pos') })}
            </Button>
          ) : null}
          <LanguageSwitcher />
          {session ? (
            <span className="hidden text-sm text-fg-muted md:inline" data-testid="user-name">
              {session.actor.fullName}
            </span>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            loading={logout.isPending}
            onClick={() => logout.mutate()}
          >
            {t('common:actions.signOut')}
          </Button>
        </header>
        {branchChoice ? (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 grid place-items-center bg-fg/40 p-4"
          >
            <div className="w-full max-w-sm rounded-lg bg-surface p-5 shadow-lg">
              <BranchList
                branches={branchChoice}
                onSelect={(branchId) => switchToPos.mutate({ target: 'pos', branchId })}
              />
              <Button variant="ghost" block className="mt-3" onClick={() => switchToPos.reset()}>
                {t('common:actions.back')}
              </Button>
            </div>
          </div>
        ) : null}
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
