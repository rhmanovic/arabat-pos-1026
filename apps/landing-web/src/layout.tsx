import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PublicTrialOffer } from '@arabat/contracts';
import { CONTACT_EMAIL, type Content, content, type Language } from './content.js';

export const STORAGE_KEY = 'arabat.landing.lang';
const SECTIONS = ['home', 'features', 'why', 'start'] as const;
type SectionId = (typeof SECTIONS)[number];
const NAV = ['home', 'features', 'why', 'pricing', 'start'] as const;
export type Page = 'home' | 'pricing' | 'start';

/**
 * The site's single call to action (ADR-0115 amendment 3): the pricing page, where the visitor
 * picks devices and opens the trial account. On the pricing page itself it scrolls to the steps.
 */
export const REGISTER_URL = '/pricing';
const signupHref = (page: Page) => (page === 'pricing' ? '#configure' : REGISTER_URL);
export const SIGN_IN_URL = '/manager/';

export function initialLanguage(): Language {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
}

/** The section currently under the sticky header, for the active nav link. */
function useActiveSection(): SectionId {
  const [active, setActive] = useState<SectionId>('home');
  useEffect(() => {
    const update = () => {
      const y = window.scrollY + 140;
      let current: SectionId = 'home';
      for (const id of SECTIONS) {
        const element = document.getElementById(id);
        if (element && element.offsetTop <= y) current = id;
      }
      setActive(current);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  return active;
}

export const primaryButton =
  'inline-flex items-center justify-center rounded-full bg-brand px-8 py-3 text-lg font-medium text-white shadow-lg shadow-brand/25 transition hover:-translate-y-0.5 hover:bg-coral hover:shadow-coral/25';
export const outlineButton =
  'inline-flex items-center justify-center rounded-full border-2 border-brand px-8 py-3 text-lg font-medium text-brand transition hover:bg-brand hover:text-white';

/** Price and trial length from the platform (ADR-0115); null while loading or if unavailable. */
export function useTrialOffer(): PublicTrialOffer | null {
  const [offer, setOffer] = useState<PublicTrialOffer | null>(null);
  useEffect(() => {
    let active = true;
    fetch('/api/v1/public/trial', { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (response.ok && active) setOffer((await response.json()) as PublicTrialOffer);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return offer;
}

/** "99.000" → "99" for display only. */
export const shortAmount = (amount: string) => amount.replace(/\.000$/, '');

/** Language of both pages: Arabic by default, remembered in the browser, mirrored on <html>. */
export function useLanguage(title: (t: Content) => string) {
  const [lang, setLang] = useState<Language>(initialLanguage);
  const t = content[lang];
  const pageTitle = title(t);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = pageTitle;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Storage may be blocked (private mode); the page still works in the chosen language.
    }
  }, [lang, pageTitle]);
  return { lang, t, toggleLanguage: () => setLang(lang === 'ar' ? 'en' : 'ar') };
}

export function Header({
  t,
  onToggleLanguage,
  page,
}: {
  t: Content;
  onToggleLanguage: () => void;
  page: Page;
}) {
  const section = useActiveSection();
  const active = page === 'pricing' ? 'pricing' : page === 'home' ? section : '';
  const [menuOpen, setMenuOpen] = useState(false);
  const home = page === 'home' ? '' : '/';
  const links = NAV.map((id) => ({
    id,
    label: t.nav[id],
    href: id === 'pricing' ? '/pricing' : `${home}#${id}`,
  }));

  return (
    <header className="sticky top-0 z-40 border-b border-[#eef0f2] bg-white/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <a href={`${home}#home`} className="shrink-0">
          <img src="/img/logo.webp" alt="Arabat" width={160} height={48} className="h-9 w-auto" />
        </a>
        <nav className="hidden lg:block" aria-label="primary">
          <ul className="flex items-center gap-7">
            {links.map((link) => (
              <li key={link.id}>
                <a
                  href={link.href}
                  aria-current={active === link.id ? 'true' : undefined}
                  className={`border-b-2 pb-1 transition-colors ${
                    active === link.id
                      ? 'border-brand text-brand'
                      : 'border-transparent text-muted hover:border-brand hover:text-brand'
                  }`}
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <button
            type="button"
            onClick={onToggleLanguage}
            className="rounded-full border border-brand px-4 py-1.5 text-sm text-brand transition hover:bg-brand hover:text-white"
          >
            {t.switchLanguage}
          </button>
          <a href={SIGN_IN_URL} className="px-2 text-sm text-muted hover:text-brand">
            {t.signIn}
          </a>
          <a
            href={signupHref(page)}
            className="rounded-full bg-brand px-5 py-2 text-sm font-medium text-white transition hover:bg-coral"
          >
            {t.signupCta}
          </a>
        </div>
        <button
          type="button"
          className="rounded-md p-2 text-ink lg:hidden"
          aria-label={t.openMenu}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </div>

      {menuOpen ? (
        <MobileMenu
          t={t}
          links={links}
          active={active}
          signupHref={signupHref(page)}
          onToggleLanguage={onToggleLanguage}
          onClose={() => setMenuOpen(false)}
        />
      ) : null}
    </header>
  );
}

/**
 * Phone menu. Rendered into <body>: the blurred sticky header would otherwise become the
 * containing block of a `fixed` element and trap the menu inside its own box.
 */
function MobileMenu({
  t,
  links,
  active,
  signupHref,
  onToggleLanguage,
  onClose,
}: {
  t: Content;
  links: { id: string; label: string; href: string }[];
  active: string;
  signupHref: string;
  onToggleLanguage: () => void;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={t.openMenu}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={t.closeMenu}
        className="menu-fade absolute inset-0 bg-night/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="menu-slide absolute inset-y-0 end-0 flex w-[85%] max-w-sm flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#eef0f2] px-5 py-4">
          <img src="/img/logo.webp" alt="Arabat" className="h-8 w-auto" />
          <button
            ref={close}
            type="button"
            aria-label={t.closeMenu}
            className="grid size-11 place-items-center rounded-full bg-sand text-ink transition hover:bg-brand-soft"
            onClick={onClose}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6 6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-4 py-4" aria-label="primary">
          <ul className="flex flex-col gap-1">
            {links.map((link, index) => (
              <li
                key={link.id}
                className="menu-item"
                style={{ animationDelay: `${0.05 + index * 0.04}s` }}
              >
                <a
                  href={link.href}
                  onClick={onClose}
                  aria-current={active === link.id ? 'true' : undefined}
                  className={`flex items-center justify-between rounded-2xl px-4 py-3.5 text-lg transition ${
                    active === link.id
                      ? 'bg-brand-soft font-bold text-brand'
                      : 'text-ink hover:bg-sand'
                  }`}
                >
                  {link.label}
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                    className="rtl:rotate-180 opacity-40"
                  >
                    <path
                      d="m9 6 6 6-6 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex flex-col gap-3 border-t border-[#eef0f2] p-5">
          <a
            href={signupHref}
            onClick={onClose}
            className="rounded-full bg-brand py-3.5 text-center text-lg font-medium text-white shadow-lg shadow-brand/25"
          >
            {t.signupCta}
          </a>
          <a href={SIGN_IN_URL} className="py-2 text-center text-muted">
            {t.signIn}
          </a>
          <button type="button" onClick={onToggleLanguage} className="py-2 text-muted">
            🌐 {t.switchLanguage}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function Footer({ t, page }: { t: Content; page: Page }) {
  const year = String(new Date().getFullYear());
  return (
    <footer>
      <div className={page === 'pricing' ? 'bg-brand px-4 py-14 text-center' : 'hidden'}>
        <p className="text-sun">{t.footer.accent}</p>
        <h2 className="mt-2 text-3xl font-bold text-white sm:text-4xl">{t.footer.headline}</h2>
        <p className="mt-3 text-white/90">{t.footer.text}</p>
        <a
          href={signupHref(page)}
          className="mt-8 inline-flex rounded-full bg-white px-8 py-3 text-lg font-medium text-brand shadow-lg transition hover:-translate-y-0.5"
        >
          {t.signupCta}
        </a>
      </div>
      {/* Never the same background as the section above it (the start page's form sits on sand). */}
      <div className={page === 'start' ? 'border-t border-[#eef0f2] bg-white' : 'bg-sand'}>
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted sm:flex-row sm:px-6">
          <p>{t.footer.copyright.replace('{year}', year)}</p>
          <div className="flex items-center gap-2">
            <a href={SIGN_IN_URL} className="hover:text-brand">
              {t.signIn}
            </a>
            <span aria-hidden="true">•</span>
            <a href={page === 'home' ? '#start' : '/#start'} className="hover:text-brand">
              {t.nav.start}
            </a>
            <span aria-hidden="true">•</span>
            <a href="/pricing" className="hover:text-brand">
              {t.nav.pricing}
            </a>
            <span aria-hidden="true">•</span>
            <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-brand" dir="ltr">
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
