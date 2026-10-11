import { Badge, cn } from '@arabat/ui';
import { ApiStatus, LanguageSwitcher } from '@arabat/web-core';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';

const NAV = [
  { key: 'overview', to: '/' },
  { key: 'merchants', milestone: 'M1' },
  { key: 'operators', milestone: 'M1' },
  { key: 'audit', milestone: 'M1' },
  { key: 'plans', milestone: 'M8' },
] as const;

/** Dense operator console: dark top bar, compact start-side navigation. */
export function PlatformLayout() {
  const { t } = useTranslation();
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
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <nav
          aria-label={t('navLabel')}
          className="flex gap-1 overflow-x-auto border-b border-border bg-surface p-2 md:w-52 md:flex-col md:border-e md:border-b-0"
        >
          {NAV.map((item) =>
            'to' in item ? (
              <NavLink
                key={item.key}
                to={item.to}
                end
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
                <span className="text-xs">({item.milestone})</span>
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
