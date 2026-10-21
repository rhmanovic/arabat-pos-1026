import {
  Badge,
  Button,
  Dialog,
  Icon,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Select,
  cn,
} from '@arabat/ui';
import {
  ApiStatus,
  BranchList,
  LanguageSwitcher,
  MerchantPicker,
  ThemeSwitch,
  localizedName,
  useApi,
  useAuth,
  useLogout,
  useMediaQuery,
  useSwitchInterface,
} from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { ManagerAssistant } from '../app/assistant.js';
import { BranchContextProvider, useBranchContext } from '../app/context.js';
import { NAV, type NavItem, TAB_KEYS } from '../app/navigation.js';

const SECTIONS = ['main', 'operations', 'people', 'organization'] as const;

/**
 * Business management shell (look of ADR-0131, shared with the online console): an icon
 * sidebar with a gradient active item on large screens; on phones a greeting top bar, the menu
 * as a side panel and a floating bottom tab bar under the thumb. Light, dark or the device's
 * choice.
 */
export function ManagerLayout() {
  return (
    <BranchContextProvider>
      <Shell />
    </BranchContextProvider>
  );
}

function Shell() {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { hasPermission } = useAuth();
  const visible = (item: NavItem) => item.anyOf.some((p) => hasPermission(p));
  // The tab bar exists only on phones and tablets (and so never doubles the sidebar's links).
  const phone = useMediaQuery('(max-width: 1023.98px)');

  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[17rem_1fr]">
      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-40 flex w-72 flex-col border-e border-border bg-surface transition-transform lg:sticky lg:top-0 lg:h-dvh lg:w-auto',
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
        {/* On phones the branch filter lives in the menu (the top bar has no room for it). */}
        <div className="px-4 pb-3 md:hidden">
          <BranchSelect className="w-full" />
        </div>
        <nav aria-label={t('navLabel')} className="flex-1 overflow-y-auto px-3 pb-3">
          {SECTIONS.map((section) => {
            const items = NAV.filter((i) => i.section === section && visible(i));
            if (items.length === 0) return null;
            return (
              <div key={section} className="mb-5">
                {section !== 'main' ? (
                  <p className="px-3 pb-2 text-xs font-semibold text-fg-subtle">
                    {t(`nav.section${section[0]!.toUpperCase()}${section.slice(1)}`)}
                  </p>
                ) : null}
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
                      ) : item.available ? (
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
                        </NavLink>
                      ) : (
                        <span
                          aria-disabled="true"
                          className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg-subtle lg:min-h-10"
                        >
                          <Icon name={item.icon} className="size-5" />
                          <span className="flex-1">{t(`nav.${item.key}`)}</span>
                          <Badge>{t('comingSoon')}</Badge>
                        </span>
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
        <main className="vibe-enter mx-auto w-full max-w-7xl min-w-0 flex-1 p-4 pb-32 sm:p-6 sm:pb-32 lg:p-8 lg:pb-24">
          <Outlet />
        </main>
      </div>
      {phone ? <TabBar visible={visible} onMore={() => setMenuOpen(true)} /> : null}
      {/* Above every page, on every page: the thread survives navigation. */}
      <ManagerAssistant />
    </div>
  );
}

/** Phones: the four most used pages the user may open and "More" (the full menu). */
function TabBar({ visible, onMore }: { visible: (item: NavItem) => boolean; onMore: () => void }) {
  const { t } = useTranslation();
  const tabs = TAB_KEYS.map((k) => NAV.find((i) => i.key === k))
    .filter((i): i is NavItem => Boolean(i && i.available && visible(i)))
    .slice(0, 4);
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
            cn(tab, 'rounded-lg', isActive ? 'text-primary' : 'text-fg-muted')
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
              <span className="max-w-full truncate px-1">
                {t(item.key === 'dashboard' ? 'nav.tab_dashboard' : `nav.${item.key}`)}
              </span>
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

/** The branch the pages show (all branches for the owner or a multi-branch manager). */
function BranchSelect({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const { state } = useAuth();
  const { branchId, setBranchId, branches } = useBranchContext();
  const session = state.status === 'authenticated' ? state.session : null;
  const activeBranches = branches.filter((b) => b.status === 'active');
  if (activeBranches.length === 0) return null;
  return (
    <Select
      className={cn('h-9', className)}
      value={branchId ?? ''}
      onChange={(e) => setBranchId(e.target.value || null)}
      aria-label={t('top.branchContext')}
    >
      {activeBranches.length > 1 || session?.isOwner ? (
        <option value="">{t('top.allBranches')}</option>
      ) : null}
      {activeBranches.map((b) => (
        <option key={b.id} value={b.id}>
          {localizedName(b, i18n.language)}
        </option>
      ))}
    </Select>
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
  const api = useApi();
  const { state } = useAuth();
  const logout = useLogout('manager');
  const switchToPos = useSwitchInterface('manager');
  const { branchId, setBranchId, branches } = useBranchContext();
  const [merchantDialog, setMerchantDialog] = useState(false);
  const session = state.status === 'authenticated' ? state.session : null;
  const merchants = useQuery({
    queryKey: ['auth', 'manager', 'merchants'],
    queryFn: () => api.auth.merchants('manager'),
    enabled: merchantDialog,
  });
  const branchChoice =
    switchToPos.data?.status === 'select_branch' ? switchToPos.data.branches : null;
  const activeBranches = branches.filter((b) => b.status === 'active');
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

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex min-w-0 flex-col leading-tight">
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
        {activeBranches.length > 0 ? (
          <div className="hidden items-center gap-2 text-sm text-fg-muted md:flex">
            <span aria-hidden>{t('top.branchContext')}</span>
            <Select
              className="h-9 w-44"
              value={branchId ?? ''}
              onChange={(e) => setBranchId(e.target.value || null)}
              data-testid="branch-context"
              aria-label={t('top.branchContext')}
            >
              {activeBranches.length > 1 || session?.isOwner ? (
                <option value="">{t('top.allBranches')}</option>
              ) : null}
              {activeBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {localizedName(b, i18n.language)}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      {session?.availableInterfaces.includes('pos') ? (
        <Button
          variant="secondary"
          size="sm"
          className="max-sm:hidden"
          loading={switchToPos.isPending}
          onClick={() => switchToPos.mutate({ target: 'pos' })}
        >
          {t('common:auth.switchTo', { app: t('common:interfaces.pos') })}
        </Button>
      ) : null}

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
        {session && session.merchantCount > 1 ? (
          <MenuItem onSelect={() => setMerchantDialog(true)}>{t('top.switchCompany')}</MenuItem>
        ) : null}
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

      <Dialog
        open={merchantDialog}
        onOpenChange={setMerchantDialog}
        title={t('top.switchCompany')}
        size="sm"
      >
        {merchants.data ? (
          <MerchantPicker
            appInterface="manager"
            merchants={merchants.data.merchants.filter((m) => m.id !== session?.merchant?.id)}
            onPick={(merchantId) => api.auth.switchMerchant('manager', { merchantId })}
            onDone={async () => {
              window.location.assign('/manager/');
            }}
          />
        ) : null}
      </Dialog>
    </header>
  );
}
