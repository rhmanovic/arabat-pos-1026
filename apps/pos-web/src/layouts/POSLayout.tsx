import { Button } from '@arabat/ui';
import {
  ApiStatus,
  LanguageSwitcher,
  localizedName,
  useAuth,
  useLogout,
  useSwitchInterface,
} from '@arabat/web-core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { CartProvider } from '../sale/cart.js';

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Full-screen, touch-first register shell: one compact top strip, no sidebar, the whole
 * remaining screen belongs to the sale (BR-018). No management navigation exists here.
 */
export function POSLayout() {
  const { t, i18n } = useTranslation();
  const { state } = useAuth();
  const now = useClock();
  const logout = useLogout('pos');
  const toManager = useSwitchInterface('pos');
  const session = state.status === 'authenticated' ? state.session : null;

  return (
    <CartProvider>
      <div className="flex h-dvh flex-col overflow-hidden bg-surface-muted select-none print:hidden">
        <header
          aria-label={t('toolbarLabel')}
          className="flex h-14 shrink-0 items-center gap-3 bg-console px-3 text-console-fg sm:px-4"
        >
          <span className="text-base font-semibold">{t('title')}</span>
          <span className="hidden text-sm text-console-fg/70 sm:inline" data-testid="pos-context">
            {session?.merchant ? localizedName(session.merchant, i18n.language) : ''} ·{' '}
            {t('branch')}:{' '}
            {session?.branch ? localizedName(session.branch, i18n.language) : t('noBranch')}
          </span>
          {session ? (
            <span className="hidden text-sm md:inline">{session.actor.fullName}</span>
          ) : null}
          <div className="flex-1" />
          <ApiStatus className="hidden text-console-fg/80 md:inline-flex" />
          <time className="text-sm tabular-nums" dateTime={now.toISOString()}>
            {now.toLocaleTimeString(i18n.language, {
              hour: '2-digit',
              minute: '2-digit',
              numberingSystem: 'latn',
            })}
          </time>
          <LanguageSwitcher />
          {session?.availableInterfaces.includes('manager') ? (
            <Button
              variant="secondary"
              size="sm"
              loading={toManager.isPending}
              onClick={() => toManager.mutate({ target: 'manager' })}
            >
              {t('common:interfaces.manager')}
            </Button>
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
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
    </CartProvider>
  );
}
