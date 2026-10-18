import { useEffect, useState } from 'react';
import { content, type Language } from './content.js';

const STORAGE_KEY = 'arabat.landing.lang';

function initialLanguage(): Language {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
}

export function LandingPage() {
  const [lang, setLang] = useState<Language>(initialLanguage);
  const t = content[lang];

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = t.brand;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Storage may be blocked (private mode); the page still works in the chosen language.
    }
  }, [lang, t.brand]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <span className="text-xl font-bold text-primary">{t.brand}</span>
          <nav className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
              className="rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-surface-muted"
            >
              {t.switchLanguage}
            </button>
            <a
              href="/manager/"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover"
            >
              {t.signIn}
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:py-24">
          <h1 className="mx-auto max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">
            {t.heroTitle}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-fg-muted">{t.heroText}</p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <a
              href="/manager/"
              className="rounded-lg bg-primary px-6 py-3 font-medium text-primary-fg hover:bg-primary-hover"
            >
              {t.openManager}
            </a>
            <a
              href="/pos/"
              className="rounded-lg border border-border-strong bg-surface px-6 py-3 font-medium hover:bg-surface-muted"
            >
              {t.openPos}
            </a>
          </div>
        </section>

        <section className="bg-surface py-16">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-center text-2xl font-bold sm:text-3xl">{t.featuresTitle}</h2>
            <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {t.features.map((feature) => (
                <li key={feature.title} className="rounded-xl border border-border bg-canvas p-6">
                  <h3 className="text-lg font-semibold text-primary">{feature.title}</h3>
                  <p className="mt-2 text-fg-muted">{feature.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-6 text-center text-sm text-fg-subtle">
        © {new Date().getFullYear()} {t.footer}
      </footer>
    </div>
  );
}
