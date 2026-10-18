import { Badge, Button, cn } from '@arabat/ui';
import { ApiStatus, LanguageSwitcher, useAuth, useLogout } from '@arabat/web-core';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { useRole } from '../shared.js';

const NAV = [
  { key: 'overview', to: '/', end: true },
  { key: 'merchants', to: '/merchants', end: false },
  { key: 'trials', to: '/trials', end: false },
  { key: 'requests', to: '/requests', end: false },
  { key: 'offer', to: '/offer', end: false },
  { key: 'plans', to: '/plans', end: false },
  { key: 'audit', to: '/audit', end: false, roles: ['platform.super_admin', 'platform.support'] },
  // The record of every assistant question: the system owner alone (ADR-0107 amendment).
  { key: 'assistant', to: '/assistant', end: false, roles: ['platform.super_admin'] },
  // Operators are created with the CLI only (AUTH.md §8).
  { key: 'operators', hint: 'operatorsHint' },
] as const;

/** Dense operator console: dark top bar, compact start-side navigation. */
export function PlatformLayout() {
  const { t } = useTranslation();
  const { state } = useAuth();
  const logout = useLogout('platform');
  const { role, can } = useRole();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex h-12 items-center gap-3 bg-console px-4 text-console-fg">
        <span className="text-sm font-semibold">{t('title')}</span>
        <Badge tone="warning" className="hidden sm:inline-flex">
          {t('restricted')}
        </Badge>
        <div className="flex-1" />
        <ApiStatus className="hidden text-console-fg/80 sm:inline-flex" />
        <LanguageSwitcher />
        {state.status === 'authenticated' ? (
          <span className="hidden text-sm md:inline">
            {state.session.actor.fullName}
            {role ? ` · ${t(`role.${role}`)}` : ''}
          </span>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          loading={logout.isPending}
          onClick={() => logout.mutate()}
        >
          {t('common:actions.signOut')}
        </Button>
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <nav
          aria-label={t('navLabel')}
          className="flex gap-1 overflow-x-auto border-b border-border bg-surface p-2 md:w-52 md:flex-col md:border-e md:border-b-0"
        >
          {NAV.filter((item) => !('roles' in item) || can(...item.roles)).map((item) =>
            'to' in item ? (
              <NavLink
                key={item.key}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-sm px-3 py-1.5 text-sm whitespace-nowrap',
                    isActive ? 'bg-console text-console-fg' : 'hover:bg-surface-muted',
                  )
                }
              >
                {t(`nav.${item.key}`)}
              </NavLink>
            ) : (
              <span
                key={item.key}
                aria-disabled="true"
                className="flex items-center gap-2 px-3 py-1.5 text-sm whitespace-nowrap text-fg-subtle"
              >
                {t(`nav.${item.key}`)}
                <span className="text-xs">({t(`nav.${item.hint}`)})</span>
              </span>
            ),
          )}
        </nav>
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
