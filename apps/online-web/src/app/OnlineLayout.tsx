import { Alert, Button, Dialog, Menu, MenuItem, MenuLabel, MenuSeparator, cn } from '@arabat/ui';
import {
  ApiStatus,
  BranchList,
  LanguageSwitcher,
  localizedName,
  useApi,
  useAuth,
  useLogout,
  useSwitchInterface,
} from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { managerUrl } from './context.js';
import { NAV, type NavItem } from './navigation.js';

const SECTIONS = ['store', 'shared'] as const;

/**
 * Shell of the online store console (ADR-0119): its own sidebar and top bar, the management
 * session, and one click to the management app for the shared functions and the POS.
 */
export function OnlineLayout() {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { hasPermission } = useAuth();
  const visible = (item: NavItem) => item.anyOf.some((p) => hasPermission(p));
  const allowed = hasPermission('online.manage') || hasPermission('online.orders');

  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[16rem_1fr]">
      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-40 flex w-64 flex-col border-e border-border bg-surface transition-transform lg:static',
          !menuOpen && 'max-lg:ltr:-translate-x-full max-lg:rtl:translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-5">
          <span className="grid size-8 place-items-center rounded-md bg-primary text-sm font-bold text-primary-fg">
            ع
          </span>
          <div className="flex-1 leading-tight">
            <p className="text-sm font-semibold">{t('common:appName')}</p>
            <p className="text-xs text-fg-muted">{t('title')}</p>
          </div>
          <button
            type="button"
            aria-label={t('common:actions.closeMenu')}
            className="grid size-11 place-items-center rounded-md text-xl text-fg-muted hover:bg-surface-muted lg:hidden"
            onClick={() => setMenuOpen(false)}
          >
            ✕
          </button>
        </div>
        <nav aria-label={t('navLabel')} className="flex-1 overflow-y-auto p-3">
          {SECTIONS.map((section) => {
            const items = NAV.filter((i) => i.section === section && visible(i));
            if (items.length === 0) return null;
            return (
              <div key={section} className="mb-4">
                <p className="px-3 pb-1 text-xs font-medium text-fg-subtle">
                  {t(`nav.section_${section}`)}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {items.map((item) => (
                    <li key={item.key}>
                      {item.external ? (
                        <a
                          href={item.to}
                          className="flex min-h-11 items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium text-fg hover:bg-surface-muted lg:min-h-0"
                        >
                          {t(`nav.${item.key}`)}
                          <span aria-hidden className="text-fg-subtle">
                            ↗
                          </span>
                        </a>
                      ) : (
                        <NavLink
                          to={item.to}
                          end={item.to === '/'}
                          onClick={() => setMenuOpen(false)}
                          className={({ isActive }) =>
                            cn(
                              'flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium lg:min-h-0',
                              isActive
                                ? 'bg-primary-soft text-primary'
                                : 'text-fg hover:bg-surface-muted',
                            )
                          }
                        >
                          {t(`nav.${item.key}`)}
                        </NavLink>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-border p-3">
          <ApiStatus />
        </div>
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
        <TopBar onOpenMenu={() => setMenuOpen(true)} menuOpen={menuOpen} />
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 pb-20 sm:p-6 sm:pb-20 lg:p-8 lg:pb-20">
          <PlanNotice />
          {allowed ? <Outlet /> : <Alert tone="warning">{t('noAccess')}</Alert>}
        </main>
      </div>
    </div>
  );
}

/** The online store is a plan feature: say so instead of letting publishing fail later. */
function PlanNotice() {
  const { t } = useTranslation();
  const api = useApi();
  const { hasPermission } = useAuth();
  const sub = useQuery({
    queryKey: ['online', 'subscription'],
    queryFn: () => api.subscription.get(),
    enabled: hasPermission('merchant.settings.read'),
  });
  if (!sub.data || sub.data.plan.features.includes('ecommerce')) return null;
  return (
    <Alert tone="warning" className="mb-4">
      {t('notInPlan')}{' '}
      <a className="text-primary hover:underline" href={managerUrl('subscription')}>
        {t('subscriptionLink')}
      </a>
    </Alert>
  );
}

function TopBar({ onOpenMenu, menuOpen }: { onOpenMenu: () => void; menuOpen: boolean }) {
  const { t, i18n } = useTranslation();
  const { state } = useAuth();
  const logout = useLogout('manager');
  const switchToPos = useSwitchInterface('manager');
  const session = state.status === 'authenticated' ? state.session : null;
  const branchChoice =
    switchToPos.data?.status === 'select_branch' ? switchToPos.data.branches : null;

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur sm:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label={t('common:actions.openMenu')}
        aria-expanded={menuOpen}
        onClick={onOpenMenu}
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
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {session?.merchant ? (
          <p className="truncate text-sm font-semibold" data-testid="merchant-name">
            {localizedName(session.merchant, i18n.language)}
          </p>
        ) : null}
      </div>
      <a href={managerUrl()} className="max-sm:hidden" data-testid="switch-to-manager">
        <Button variant="secondary" size="sm">
          {t('top.openManager')}
        </Button>
      </a>
      <Menu
        trigger={
          <Button variant="ghost" size="sm" aria-label={t('top.myAccount')} data-testid="user-menu">
            <span className="grid size-7 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
              {session?.actor.fullName.slice(0, 1)}
            </span>
            <span className="max-md:hidden" data-testid="user-name">
              {session?.actor.fullName}
            </span>
          </Button>
        }
      >
        <MenuLabel>
          <span className="block font-medium text-fg">{session?.actor.fullName}</span>
          <span dir="ltr">{session?.actor.email}</span>
        </MenuLabel>
        <MenuSeparator />
        <div className="px-3 py-2">
          <LanguageSwitcher />
        </div>
        <MenuItem onSelect={() => window.location.assign(managerUrl())}>
          {t('top.openManager')}
        </MenuItem>
        {session?.availableInterfaces.includes('pos') ? (
          <MenuItem onSelect={() => switchToPos.mutate({ target: 'pos' })}>
            {t('top.openPos')}
          </MenuItem>
        ) : null}
        <MenuSeparator />
        <MenuItem tone="danger" onSelect={() => logout.mutate()}>
          {t('common:actions.signOut')}
        </MenuItem>
      </Menu>
      <Dialog
        open={Boolean(branchChoice)}
        onOpenChange={(open) => !open && switchToPos.reset()}
        title={t('top.openPos')}
        size="sm"
      >
        {branchChoice ? (
          <BranchList
            branches={branchChoice}
            onSelect={(id) => switchToPos.mutate({ target: 'pos', branchId: id })}
          />
        ) : null}
      </Dialog>
    </header>
  );
}
