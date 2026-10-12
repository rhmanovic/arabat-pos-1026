import { Button } from '@arabat/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCart } from '../sale/cart.js';

const CHECK_EVERY_MS = 5 * 60_000;

/** The hashed entry script of a built page, e.g. `/pos/assets/index-AbC123.js`. */
function entryScript(html: string): string | null {
  return /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1] ?? null;
}

/**
 * Notices a newer deployment: compares the entry script of the served index.html with the
 * one this tab loaded, when the tab becomes visible and every few minutes. An empty sale
 * reloads silently; otherwise a banner offers the reload so no cart is lost.
 */
export function UpdateBanner() {
  const { t } = useTranslation();
  const cart = useCart();
  const [available, setAvailable] = useState(false);
  const empty = cart.state.lines.length === 0;

  useEffect(() => {
    const loaded = entryScript(document.documentElement.outerHTML);
    if (!loaded || import.meta.env.DEV) return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(import.meta.env.BASE_URL, { cache: 'no-store' });
        const served = entryScript(await res.text());
        if (!stopped && served && served !== loaded) setAvailable(true);
      } catch {
        // Offline or deploying: try again later.
      }
    };
    const id = setInterval(() => void check(), CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  useEffect(() => {
    if (available && empty) window.location.reload();
  }, [available, empty]);

  if (!available || empty) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 bg-primary px-3 py-2 text-sm text-primary-fg"
    >
      <span>{t('update.available')}</span>
      <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
        {t('update.reload')}
      </Button>
    </div>
  );
}
