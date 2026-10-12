import { Button, Menu, MenuItem } from '@arabat/ui';
import {
  ApiStatus,
  LanguageSwitcher,
  localizedName,
  useApi,
  useAuth,
  useLogout,
  useSwitchInterface,
} from '@arabat/web-core';
import { POS_IDLE_LOCK_SECONDS } from '@arabat/contracts';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
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
 * Locks the till after POS_IDLE_LOCK_SECONDS without touch, mouse or keyboard input (not
 * merely without requests: the screen polls in the background). The server enforces it.
 */
function useIdleLock(lock: () => void, enabled: boolean) {
  const last = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    last.current = Date.now();
    const seen = () => {
      last.current = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
    for (const e of events) window.addEventListener(e, seen, { passive: true });
    const id = setInterval(() => {
      if (Date.now() - last.current >= POS_IDLE_LOCK_SECONDS * 1000) lock();
    }, 10_000);
    return () => {
      for (const e of events) window.removeEventListener(e, seen);
      clearInterval(id);
    };
  }, [lock, enabled]);
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
  const api = useApi();
  const { refresh } = useAuth();
  const lock = useMutation({
    mutationFn: () => api.auth.posLock(),
    onSettled: () => refresh(),
  });
  const lockNow = lock.mutate;
  useIdleLock(lockNow, session !== null && !lock.isPending);

  return (
    <CartProvider>
      <div className="flex h-dvh flex-col overflow-hidden bg-surface-muted select-none print:hidden">
        <header
          aria-label={t('toolbarLabel')}
          className="flex h-14 shrink-0 items-center gap-2 bg-console px-3 text-console-fg sm:gap-3 sm:px-4"
        >
          <span className="truncate text-base font-semibold whitespace-nowrap">{t('title')}</span>
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
          <time className="hidden text-sm tabular-nums sm:inline" dateTime={now.toISOString()}>
            {now.toLocaleTimeString(i18n.language, {
              hour: '2-digit',
              minute: '2-digit',
              numberingSystem: 'latn',
            })}
          </time>
          <LanguageSwitcher className="hidden sm:inline-flex" />
          {/* Phones: the session actions fold into one menu so the strip fits one line. */}
          <div className="sm:hidden">
            <Menu
              trigger={
                <Button
                  variant="secondary"
                  size="icon"
                  className="size-11 text-lg"
                  aria-label={t('moreActions')}
                >
                  ☰
                </Button>
              }
            >
              {session?.availableInterfaces.includes('manager') ? (
                <MenuItem onSelect={() => toManager.mutate({ target: 'manager' })}>
                  {t('common:interfaces.manager')}
                </MenuItem>
              ) : null}
              <MenuItem onSelect={() => lockNow()}>{t('common:lock.lockNow')}</MenuItem>
              <MenuItem
                onSelect={() =>
                  void i18n.changeLanguage(i18n.resolvedLanguage === 'en' ? 'ar' : 'en')
                }
              >
                {i18n.resolvedLanguage === 'en' ? 'العربية' : 'English'}
              </MenuItem>
              <MenuItem tone="danger" onSelect={() => logout.mutate()}>
                {t('common:actions.signOut')}
              </MenuItem>
            </Menu>
          </div>
          <div className="hidden items-center gap-3 sm:flex">
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
              loading={lock.isPending}
              onClick={() => lockNow()}
            >
              {t('common:lock.lockNow')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={logout.isPending}
              onClick={() => logout.mutate()}
            >
              {t('common:actions.signOut')}
            </Button>
          </div>
        </header>
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
    </CartProvider>
  );
}
