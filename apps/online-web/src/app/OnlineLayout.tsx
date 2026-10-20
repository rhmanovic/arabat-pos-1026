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
import { useOrderOverview } from '../features/shared.js';
import { managerUrl } from './context.js';
import { Icon } from './icons.js';
import { NAV, type NavItem } from './navigation.js';
import { type ThemeMode, useThemeMode } from './theme.js';

const SECTIONS = ['store', 'shared'] as const;

/** Orders waiting for someone: new pay-on-receipt orders and those that need a look. */
function useWaitingOrders(enabled: boolean) {
  const overview = useOrderOverview(enabled);
  const counts = overview.data?.counts ?? {};
  return (counts['placed'] ?? 0) + (counts['needs_attention'] ?? 0);
}

/**
 * Shell of the online store console (ADR-0119, look of ADR-0127): an icon sidebar on large
 * screens, a bottom tab bar on phones, the management session, and one click to the
 * management app for the shared functions and the POS.
 */
export function OnlineLayout() {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { hasPermission } = useAuth();
  const visible = (item: NavItem) => item.anyOf.some((p) => hasPermission(p));
  const allowed = hasPermission('online.manage') || hasPermission('online.orders');
  const waiting = useWaitingOrders(hasPermission('online.orders'));

  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[17rem_1fr]">
      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-40 flex w-72 flex-col border-e border-border bg-surface transition-transform lg:static lg:w-auto',
          !menuOpen && 'max-lg:ltr:-translate-x-full max-lg:rtl:translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 px-5">
          <span className="vibe-gradient vibe-glow grid size-9 place-items-center rounded-lg text-base font-bold">
            ع
          </span>
          <div className="flex-1 leading-tight">
            <p className="text-sm font-bold">{t('common:appName')}</p>
            <p className="text-xs text-fg-muted">{t('title')}</p>
          </div>
          <button
            type="button"
            aria-label={t('common:actions.closeMenu')}
            className="grid size-11 place-items-center rounded-lg text-fg-muted hover:bg-surface-muted lg:hidden"
            onClick={() => setMenuOpen(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <nav aria-label={t('navLabel')} className="flex-1 overflow-y-auto px-3 pb-3">
          {SECTIONS.map((section) => {
            const items = NAV.filter((i) => i.section === section && visible(i));
            if (items.length === 0) return null;
            return (
              <div key={section} className="mb-5">
                <p className="px-3 pb-2 text-xs font-semibold text-fg-subtle">
                  {t(`nav.section_${section}`)}
                </p>
                <ul className="flex flex-col gap-1">
                  {items.map((item) => (
                    <li key={item.key}>
                      {item.external ? (
                        <a
                          href={item.to}
                          className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-fg hover:bg-surface-muted lg:min-h-10"
                        >
                          <Icon name={item.icon} className="size-5 text-fg-muted" />
                          <span className="flex-1">{t(`nav.${item.key}`)}</span>
                          <Icon
                            name="external"
                            className="size-4 text-fg-subtle rtl:-scale-x-100"
                          />
                        </a>
                      ) : (
                        <NavLink
                          to={item.to}
                          end={item.to === '/'}
                          onClick={() => setMenuOpen(false)}
                          className={({ isActive }) =>
                            cn(
                              'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors lg:min-h-10',
                              isActive
                                ? 'vibe-gradient vibe-glow'
                                : 'text-fg hover:bg-surface-muted',
                            )
                          }
                        >
                          <Icon name={item.icon} className="size-5" />
                          <span className="flex-1">{t(`nav.${item.key}`)}</span>
                          {item.key === 'orders' && waiting > 0 ? (
                            <span
                              aria-hidden
                              className="grid min-w-6 place-items-center rounded-full bg-accent px-1.5 text-xs font-bold text-accent-fg"
                            >
                              {waiting}
                            </span>
                          ) : null}
                        </NavLink>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="flex flex-col gap-3 border-t border-border p-3">
          <ThemeSwitch />
          <ApiStatus />
        </div>
      </aside>

      {menuOpen ? (
        <button
          type="button"
          aria-label={t('common:actions.closeMenu')}
          className="fixed inset-0 z-30 bg-fg/30 backdrop-blur-sm lg:hidden"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <div className="flex min-w-0 flex-col">
        <TopBar onOpenMenu={() => setMenuOpen(true)} menuOpen={menuOpen} />
        <main className="vibe-enter mx-auto w-full max-w-7xl flex-1 p-4 pb-28 sm:p-6 sm:pb-28 lg:p-8 lg:pb-20">
          <PlanNotice />
          {allowed ? <Outlet /> : <Alert tone="warning">{t('noAccess')}</Alert>}
        </main>
      </div>

      <TabBar visible={visible} waiting={waiting} onMore={() => setMenuOpen(true)} />
    </div>
  );
}

/** Phones: the four most used pages and "More" (the full menu), always under the thumb. */
function TabBar({
  visible,
  waiting,
  onMore,
}: {
  visible: (item: NavItem) => boolean;
  waiting: number;
  onMore: () => void;
}) {
  const { t } = useTranslation();
  const tabs = NAV.filter((i) => i.tab && visible(i));
  if (tabs.length === 0) return null;
  const tab =
    'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[0.7rem] font-medium';
  return (
    <nav
      aria-label={t('nav.tabsLabel')}
      className="fixed inset-x-3 bottom-3 z-20 flex rounded-xl border border-border bg-surface/90 p-1 shadow-lg backdrop-blur-md lg:hidden"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map((item) => (
        <NavLink
          key={item.key}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            cn(tab, 'relative rounded-lg', isActive ? 'text-primary' : 'text-fg-muted')
          }
        >
          {({ isActive }) => (
            <>
              <span
                className={cn(
                  'grid h-7 w-12 place-items-center rounded-full transition-colors',
                  isActive && 'bg-primary-soft',
                )}
              >
                <Icon name={item.icon} className="size-5" />
              </span>
              <span>{t(`nav.tab_${item.key}`)}</span>
              {item.key === 'orders' && waiting > 0 ? (
                <span
                  aria-hidden
                  className="absolute top-1 start-1/2 grid min-w-5 place-items-center rounded-full bg-accent px-1 text-[0.65rem] font-bold text-accent-fg ltr:ms-2 rtl:me-2"
                >
                  {waiting}
                </span>
              ) : null}
            </>
          )}
        </NavLink>
      ))}
      <button type="button" className={cn(tab, 'rounded-lg text-fg-muted')} onClick={onMore}>
        <span className="grid h-7 w-12 place-items-center rounded-full">
          <Icon name="more" className="size-5" />
        </span>
        <span>{t('nav.more')}</span>
      </button>
    </nav>
  );
}

/** Light, dark or the device's choice, as three small buttons. */
function ThemeSwitch() {
  const { t } = useTranslation();
  const [mode, setMode] = useThemeMode();
  const options: { mode: ThemeMode; icon: 'sun' | 'moon' | 'system' }[] = [
    { mode: 'light', icon: 'sun' },
    { mode: 'dark', icon: 'moon' },
    { mode: 'system', icon: 'system' },
  ];
  return (
    <div
      role="group"
      aria-label={t('theme.label')}
      className="flex rounded-lg bg-surface-muted p-1"
    >
      {options.map((o) => (
        <button
          key={o.mode}
          type="button"
          aria-pressed={mode === o.mode}
          title={t(`theme.${o.mode}`)}
          onClick={() => setMode(o.mode)}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors',
            mode === o.mode ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
          )}
        >
          <Icon name={o.icon} className="size-4" />
          <span>{t(`theme.${o.mode}`)}</span>
        </button>
      ))}
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

/** Morning, afternoon or evening in the visitor's clock, for the greeting. */
function greetingKey(hour: number) {
  if (hour < 12) return 'top.morning';
  if (hour < 18) return 'top.afternoon';
  return 'top.evening';
}

function TopBar({ onOpenMenu, menuOpen }: { onOpenMenu: () => void; menuOpen: boolean }) {
  const { t, i18n } = useTranslation();
  const { state } = useAuth();
  const logout = useLogout('manager');
  const switchToPos = useSwitchInterface('manager');
  const session = state.status === 'authenticated' ? state.session : null;
  const branchChoice =
    switchToPos.data?.status === 'select_branch' ? switchToPos.data.branches : null;
  const [hour] = useState(() => new Date().getHours());
  const firstName = session?.actor.fullName.split(' ')[0] ?? '';

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-canvas/85 px-4 backdrop-blur-md sm:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label={t('common:actions.openMenu')}
        aria-expanded={menuOpen}
        onClick={onOpenMenu}
      >
        <Icon name="menu" />
      </Button>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        {firstName ? (
          <p className="truncate text-sm font-bold">
            {t(greetingKey(hour), { name: firstName })} <span aria-hidden>👋</span>
          </p>
        ) : null}
        {session?.merchant ? (
          <p className="truncate text-xs text-fg-muted" data-testid="merchant-name">
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
            <span className="vibe-gradient grid size-8 place-items-center rounded-full text-xs font-bold">
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
