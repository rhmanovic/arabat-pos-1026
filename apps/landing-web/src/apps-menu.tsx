import { useEffect, useId, useRef, useState } from 'react';
import type { PublicSiteApp, PublicSiteApps } from '@arabat/contracts';
import type { Content, Language } from './content.js';

/**
 * The "Our apps" menu (ADR-0117): the list is kept by platform operators and read from the API;
 * empty (or unreachable) → no menu at all, the navbar is unchanged.
 */
export function useSiteApps(): PublicSiteApp[] {
  const [apps, setApps] = useState<PublicSiteApp[]>([]);
  useEffect(() => {
    let active = true;
    fetch('/api/v1/public/site/apps', { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok || !active) return;
        const data = (await response.json()) as Partial<PublicSiteApps>;
        if (active && Array.isArray(data.apps)) setApps(data.apps);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return apps;
}

const name = (app: PublicSiteApp, lang: Language) => (lang === 'ar' ? app.nameAr : app.nameEn);
const description = (app: PublicSiteApp, lang: Language) =>
  lang === 'ar' ? app.descriptionAr : app.descriptionEn;
const linkProps = (app: PublicSiteApp) =>
  app.openInNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {};

/** Desktop: a navbar item that opens a panel; closes on Escape, outside click or focus leaving. */
export function AppsDropdown({
  t,
  lang,
  apps,
}: {
  t: Content;
  lang: Language;
  apps: PublicSiteApp[];
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLLIElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <li
      ref={root}
      className="relative"
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 border-b-2 pb-1 transition-colors ${
          open
            ? 'border-brand text-brand'
            : 'border-transparent text-muted hover:border-brand hover:text-brand'
        }`}
      >
        {t.apps}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {open ? (
        <div
          id={id}
          className="menu-fade absolute start-0 top-full z-50 mt-3 w-80 rounded-2xl border border-[#eef0f2] bg-white p-2 shadow-xl"
        >
          <p className="px-3 pb-1 pt-2 text-xs text-muted">{t.appsHint}</p>
          <ul className="flex flex-col">
            {apps.map((app) => (
              <li key={app.id}>
                <a
                  href={app.url}
                  {...linkProps(app)}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-sand"
                >
                  <AppIcon icon={app.icon} />
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{name(app, lang)}</span>
                    {description(app, lang) ? (
                      <span className="block truncate text-xs text-muted">
                        {description(app, lang)}
                      </span>
                    ) : null}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

/** Phone: a titled group inside the slide-in menu. */
export function AppsMenuSection({
  t,
  lang,
  apps,
  onClose,
  delay,
}: {
  t: Content;
  lang: Language;
  apps: PublicSiteApp[];
  onClose: () => void;
  delay: number;
}) {
  return (
    <li className="menu-item mt-3" style={{ animationDelay: `${delay}s` }}>
      <p className="px-4 pb-1 text-sm font-bold text-muted">{t.apps}</p>
      <ul className="flex flex-col gap-0.5">
        {apps.map((app) => (
          <li key={app.id}>
            <a
              href={app.url}
              {...linkProps(app)}
              onClick={onClose}
              className="flex items-center gap-3 rounded-2xl px-4 py-3 text-ink transition hover:bg-sand"
            >
              <AppIcon icon={app.icon} />
              <span className="min-w-0">
                <span className="block">{name(app, lang)}</span>
                {description(app, lang) ? (
                  <span className="block truncate text-xs text-muted">
                    {description(app, lang)}
                  </span>
                ) : null}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </li>
  );
}

const PATHS: Record<PublicSiteApp['icon'], string> = {
  dashboard: 'M4 5h7v6H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 13h7v6H4z',
  till: 'M4 7h16v4H4zM6 11v8h12v-8M9 15h6',
  store: 'M4 9l1.5-4h13L20 9M4 9h16v10H4zM10 19v-5h4v5',
  links:
    'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6.8M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5',
  computer: 'M3 5h18v11H3zM9 20h6M12 16v4',
  phone: 'M7 3h10v18H7zM11 18h2',
  other: 'M12 3l2.5 5.5L20 9l-4 4 1 6-5-2.7L7 19l1-6-4-4 5.5-.5z',
};

function AppIcon({ icon }: { icon: PublicSiteApp['icon'] }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d={PATHS[icon] ?? PATHS.other}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
