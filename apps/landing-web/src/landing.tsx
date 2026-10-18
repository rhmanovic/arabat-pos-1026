import { useEffect, useState } from 'react';
import { CONTACT_EMAIL, type Content, content, type Language } from './content.js';
import { Reveal, useInView } from './reveal.js';

const STORAGE_KEY = 'arabat.landing.lang';
const SECTIONS = ['home', 'features', 'why', 'start'] as const;
type SectionId = (typeof SECTIONS)[number];

const REGISTER_URL = '/manager/register';
const SIGN_IN_URL = '/manager/';

function initialLanguage(): Language {
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

const primaryButton =
  'inline-flex items-center justify-center rounded-full bg-brand px-8 py-3 text-lg font-medium text-white shadow-lg shadow-brand/25 transition hover:-translate-y-0.5 hover:bg-coral hover:shadow-coral/25';
const outlineButton =
  'inline-flex items-center justify-center rounded-full border-2 border-brand px-8 py-3 text-lg font-medium text-brand transition hover:bg-brand hover:text-white';

export function LandingPage() {
  const [lang, setLang] = useState<Language>(initialLanguage);
  const t = content[lang];

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = t.pageTitle;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Storage may be blocked (private mode); the page still works in the chosen language.
    }
  }, [lang, t.pageTitle]);

  const toggleLanguage = () => setLang(lang === 'ar' ? 'en' : 'ar');

  return (
    <div className="flex min-h-screen flex-col">
      <Header t={t} onToggleLanguage={toggleLanguage} />
      <main className="flex-1">
        <Hero t={t} />
        <Trust t={t} />
        <Power t={t} />
        <Features t={t} />
        <Why t={t} />
        <Steps t={t} />
        <CallToAction t={t} />
      </main>
      <Footer t={t} />
    </div>
  );
}

function Header({ t, onToggleLanguage }: { t: Content; onToggleLanguage: () => void }) {
  const active = useActiveSection();
  const [menuOpen, setMenuOpen] = useState(false);
  const links = SECTIONS.map((id) => ({ id, label: t.nav[id] }));

  return (
    <header className="sticky top-0 z-40 border-b border-[#eef0f2] bg-white/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <a href="#home" className="shrink-0">
          <img src="/img/logo.webp" alt="Arabat" width={160} height={48} className="h-9 w-auto" />
        </a>
        <nav className="hidden lg:block" aria-label="primary">
          <ul className="flex items-center gap-7">
            {links.map((link) => (
              <li key={link.id}>
                <a
                  href={`#${link.id}`}
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
          <a
            href={SIGN_IN_URL}
            className="rounded-full bg-brand px-6 py-2 font-medium text-white transition hover:bg-coral"
          >
            {t.signIn}
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

      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label={t.closeMenu}
            className="absolute inset-0 bg-black/40"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-y-0 end-0 flex w-3/4 max-w-xs flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#eef0f2] p-4">
              <img src="/img/logo.webp" alt="Arabat" className="h-8 w-auto" />
              <button
                type="button"
                aria-label={t.closeMenu}
                className="p-2 text-2xl leading-none text-muted"
                onClick={() => setMenuOpen(false)}
              >
                ×
              </button>
            </div>
            <ul className="flex flex-col gap-1 p-4">
              {links.map((link) => (
                <li key={link.id}>
                  <a
                    href={`#${link.id}`}
                    onClick={() => setMenuOpen(false)}
                    className={`block rounded-lg px-3 py-2 ${
                      active === link.id ? 'bg-brand-soft text-brand' : 'text-muted'
                    }`}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
              <li className="mt-4">
                <button
                  type="button"
                  onClick={onToggleLanguage}
                  className="w-full rounded-full border border-brand py-2 text-brand"
                >
                  {t.switchLanguage}
                </button>
              </li>
              <li className="mt-2">
                <a
                  href={SIGN_IN_URL}
                  className="block w-full rounded-full bg-brand py-2 text-center text-white"
                >
                  {t.signIn}
                </a>
              </li>
            </ul>
          </div>
        </div>
      )}
    </header>
  );
}

function Hero({ t }: { t: Content }) {
  const { ref: markRef, visible: markVisible } = useInView<HTMLDivElement>();
  return (
    <section id="home" className="overflow-hidden">
      <div
        ref={markRef}
        className={`hero-mark ${markVisible ? 'visible' : ''} mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-72 sm:px-6 lg:grid-cols-2 lg:py-24`}
      >
        <div>
          <Reveal as="p" className="text-lg text-muted sm:text-xl">
            {t.hero.lead}
          </Reveal>
          <Reveal
            as="h1"
            delay={0.1}
            className="mt-3 text-4xl font-bold leading-tight sm:text-5xl lg:text-[3.4rem]"
          >
            {t.hero.title}
          </Reveal>
          <Reveal as="p" delay={0.2} className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
            {t.hero.subtitle}
          </Reveal>
          <Reveal delay={0.3} className="mt-8 flex flex-wrap gap-3">
            <a href={REGISTER_URL} className={primaryButton}>
              {t.hero.primary}
            </a>
            <a href={SIGN_IN_URL} className={outlineButton}>
              {t.hero.secondary}
            </a>
          </Reveal>
        </div>
        <Reveal direction="end" delay={0.2} className="flex justify-center lg:justify-end">
          <TillPreview t={t} />
        </Reveal>
      </div>
    </section>
  );
}

/** A small, static picture of the till: shows the product instead of describing it. */
function TillPreview({ t }: { t: Content }) {
  return (
    <div className="float w-full max-w-sm rounded-3xl border border-black/5 bg-white/95 p-5 shadow-2xl shadow-brand/20 backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="font-bold text-ink">{t.till.title}</span>
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-coral" />
          <span className="size-2.5 rounded-full bg-tangerine" />
          <span className="size-2.5 rounded-full bg-brand" />
        </span>
      </div>
      <ul className="mt-4 divide-y divide-black/5">
        {t.till.items.map((item) => (
          <li key={item.name} className="flex items-center justify-between gap-3 py-3">
            <span className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-lg bg-brand-soft text-sm font-bold text-brand">
                {item.qty}×
              </span>
              <span className="text-ink">{item.name}</span>
            </span>
            <span className="font-bold tabular-nums text-ink" dir="ltr">
              {item.price}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between rounded-2xl bg-sand px-4 py-3">
        <span className="text-muted">{t.till.totalLabel}</span>
        <span className="text-2xl font-bold tabular-nums text-ink" dir="ltr">
          {t.till.total} <span className="text-base text-muted">{t.till.currency}</span>
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <span className="rounded-full bg-brand py-3 text-center font-medium text-white">
          {t.till.pay}
        </span>
        <span className="rounded-full bg-brand-soft py-3 text-center text-sm font-medium text-brand">
          {t.till.paid}
        </span>
      </div>
    </div>
  );
}

const TRUST_ICONS = [
  // cloud
  'M7 18a5 5 0 0 1-.6-9.96A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7Z',
  // coins
  'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Zm-8 6c0 1.7 3.6 3 8 3s8-1.3 8-3m-16 6c0 1.7 3.6 3 8 3s8-1.3 8-3M4 6v12m16-12v12',
  // language
  'M3 5h10M8 3v2m3 0c-1 4-4 7-7 8m3-5c1 2 3 4 6 5m3 6 4-9 4 9m-7-2h6',
  // shield
  'M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3Zm-3 9 2 2 4-4',
];

function Trust({ t }: { t: Content }) {
  return (
    <section className="bg-sand py-16">
      <div className="mx-auto max-w-7xl px-4 text-center sm:px-6">
        <Reveal as="p" className="font-semibold text-accent-red">
          {t.trust.label}
        </Reveal>
        <Reveal as="h2" delay={0.1} className="mt-1 text-2xl font-bold sm:text-3xl">
          {t.trust.title}
        </Reveal>
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {t.trust.items.map((item, index) => (
            <Reveal
              as="li"
              key={item.title}
              delay={index * 0.15}
              className="rounded-2xl bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
            >
              <span className="mx-auto grid size-14 place-items-center rounded-full bg-brand-soft text-brand">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d={TRUST_ICONS[index]}
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <h3 className="mt-4 font-bold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{item.text}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Power({ t }: { t: Content }) {
  return (
    <section className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
      <Reveal direction="start">
        <h2 className="text-3xl font-bold leading-snug sm:text-4xl">{t.power.title}</h2>
        <p className="mt-5 text-lg leading-relaxed text-muted">{t.power.text1}</p>
        <p className="mt-4 text-lg leading-relaxed text-muted">{t.power.text2}</p>
        <a href="#features" className={`${primaryButton} mt-8`}>
          {t.power.cta}
        </a>
      </Reveal>
      <Reveal direction="end" className="flex justify-center">
        <DashboardPreview t={t} />
      </Reveal>
    </section>
  );
}

/** Relative bar heights (percent) of the illustrative week; display only. */
const WEEK_BARS = [48, 62, 55, 70, 66, 88, 100];

/** A static picture of the management dashboard (illustrative figures, KWD). */
function DashboardPreview({ t }: { t: Content }) {
  const d = t.dashboard;
  return (
    <div
      className="w-full max-w-xl rounded-3xl border border-black/5 bg-white p-5 shadow-2xl shadow-brand/15"
      aria-hidden="true"
    >
      <div className="flex items-center justify-between">
        <span className="font-bold text-ink">{d.title}</span>
        <img src="/img/logo.webp" alt="" className="h-6 w-auto" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {d.kpis.map((kpi, index) => (
          <div
            key={kpi.label}
            className={`rounded-2xl p-2.5 sm:p-3 ${index === 0 ? 'bg-brand text-white' : 'bg-sand'}`}
          >
            <div className={`text-xs ${index === 0 ? 'text-white/80' : 'text-muted'}`}>
              {kpi.label}
            </div>
            <div className="mt-1 text-[0.95rem] font-bold tabular-nums sm:text-xl" dir="ltr">
              {kpi.value}
            </div>
            {kpi.unit && (
              <div className={`text-xs ${index === 0 ? 'text-white/80' : 'text-muted'}`}>
                {kpi.unit}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-5">
        <div className="rounded-2xl bg-sand p-4 sm:col-span-3">
          <div className="text-sm text-muted">{d.chartLabel}</div>
          <div className="mt-3 flex h-32 items-end gap-2">
            {WEEK_BARS.map((height, index) => (
              <div key={d.days[index]} className="flex h-full flex-1 flex-col items-center gap-1">
                <div className="relative w-full flex-1">
                  <div
                    className={`absolute inset-x-0 bottom-0 rounded-t-md ${index === WEEK_BARS.length - 1 ? 'bg-brand' : 'bg-brand/35'}`}
                    style={{ height: `${height}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted">{d.days[index]}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl bg-sand p-4 sm:col-span-2">
          <div className="text-sm text-muted">{d.branchesLabel}</div>
          <ul className="mt-3 space-y-3">
            {d.branches.map((branch, index) => (
              <li key={branch.name} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 text-ink">
                  <span
                    className={`size-2.5 rounded-full ${['bg-brand', 'bg-tangerine', 'bg-sky'][index]}`}
                  />
                  {branch.name}
                </span>
                <span className="font-bold tabular-nums text-ink" dir="ltr">
                  {branch.value}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function FeatureIcon({ icon, size }: { icon: string; size: number }) {
  return (
    <img
      src={`/img/icons/${icon}.webp`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className="mx-auto"
    />
  );
}

function Features({ t }: { t: Content }) {
  return (
    <section id="features" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
      <Reveal className="mx-auto max-w-3xl text-center">
        <h2 className="text-3xl font-bold sm:text-4xl">{t.features.title}</h2>
        <p className="mt-4 text-lg text-muted">{t.features.text1}</p>
        <p className="mt-2 text-lg text-muted">{t.features.text2}</p>
      </Reveal>
      <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {t.features.main.map((feature, index) => (
          <Reveal
            as="li"
            key={feature.title}
            delay={index * 0.12}
            className="group rounded-2xl border border-transparent bg-[#f8f9fa] p-7 text-center transition hover:-translate-y-1 hover:border-brand/30 hover:bg-white hover:shadow-xl hover:shadow-brand/10"
          >
            <div className="transition group-hover:scale-110">
              <FeatureIcon icon={feature.icon} size={75} />
            </div>
            <h3 className="mt-4 text-lg font-bold">{feature.title}</h3>
            <p className="mt-2 leading-relaxed text-muted">{feature.text}</p>
          </Reveal>
        ))}
      </ul>

      <Reveal as="h3" className="mt-20 text-center text-2xl font-bold text-ink">
        {t.features.allTitle}
      </Reveal>
      <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {t.features.all.map((feature, index) => (
          <Reveal
            as="li"
            key={feature.title}
            delay={(index % 3) * 0.1}
            className="flex items-start gap-4 rounded-2xl bg-[#f8f9fa] p-5 transition hover:bg-white hover:shadow-lg hover:shadow-brand/10"
          >
            <img
              src={`/img/icons/${feature.icon}.webp`}
              alt=""
              width={56}
              height={56}
              loading="lazy"
              className="shrink-0"
            />
            <div>
              <h4 className="font-bold text-ink">{feature.title}</h4>
              <p className="mt-1 text-sm leading-relaxed text-muted">{feature.text}</p>
            </div>
          </Reveal>
        ))}
      </ul>
    </section>
  );
}

function Why({ t }: { t: Content }) {
  return (
    <section id="why" className="bg-night py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Reveal className="text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">{t.why.title}</h2>
          <p className="mt-3 text-lg text-white/75">{t.why.subtitle}</p>
        </Reveal>
        <ul className="mt-12 grid grid-cols-2 gap-8 lg:grid-cols-4">
          {t.why.items.map((item, index) => (
            <Reveal as="li" key={item.title} delay={index * 0.15} className="text-center">
              <span className="mx-auto grid size-20 place-items-center rounded-full bg-white/5 ring-1 ring-white/10">
                <img src={`/img/icons/${item.icon}.webp`} alt="" width={45} height={45} />
              </span>
              <h3 className="mt-4 font-bold text-white">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/70">{item.text}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Steps({ t }: { t: Content }) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
      <Reveal as="h2" className="text-center text-3xl font-bold sm:text-4xl">
        {t.steps.title}
      </Reveal>
      <ol className="mt-12 grid gap-8 md:grid-cols-3">
        {t.steps.items.map((step, index) => (
          <Reveal as="li" key={step.title} delay={index * 0.15} className="relative text-center">
            <span className="mx-auto grid size-16 place-items-center rounded-full bg-brand text-2xl font-bold text-white shadow-lg shadow-brand/30">
              {index + 1}
            </span>
            <h3 className="mt-5 text-xl font-bold">{step.title}</h3>
            <p className="mx-auto mt-2 max-w-xs leading-relaxed text-muted">{step.text}</p>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}

function CallToAction({ t }: { t: Content }) {
  return (
    <section id="start" className="px-4 pb-20 sm:px-6">
      <Reveal className="mx-auto max-w-4xl rounded-3xl bg-brand-soft px-6 py-14 text-center">
        <h2 className="text-3xl font-bold sm:text-4xl">{t.cta.title}</h2>
        <p className="mt-4 text-lg text-muted">{t.cta.text}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a href={REGISTER_URL} className={primaryButton}>
            {t.cta.primary}
          </a>
          <a href={SIGN_IN_URL} className={outlineButton}>
            {t.cta.secondary}
          </a>
        </div>
        <p className="mt-8 text-muted">
          {t.cta.contactLabel}{' '}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-medium text-brand underline-offset-4 hover:underline"
            dir="ltr"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </Reveal>
    </section>
  );
}

function Footer({ t }: { t: Content }) {
  const year = String(new Date().getFullYear());
  return (
    <footer>
      <div className="bg-brand px-4 py-14 text-center">
        <p className="text-sun">{t.footer.accent}</p>
        <h2 className="mt-2 text-3xl font-bold text-white sm:text-4xl">{t.footer.headline}</h2>
        <p className="mt-3 text-white/90">{t.footer.text}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a
            href={SIGN_IN_URL}
            className="rounded-full bg-white px-6 py-2.5 font-medium text-ink transition hover:-translate-y-0.5"
          >
            {t.footer.manager}
          </a>
          <a
            href="/pos/"
            className="rounded-full bg-white px-6 py-2.5 font-medium text-ink transition hover:-translate-y-0.5"
          >
            {t.footer.pos}
          </a>
        </div>
      </div>
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted sm:flex-row sm:px-6">
        <p>{t.footer.copyright.replace('{year}', year)}</p>
        <div className="flex items-center gap-2">
          <a href={SIGN_IN_URL} className="hover:text-brand">
            {t.signIn}
          </a>
          <span aria-hidden="true">•</span>
          <a href="#start" className="hover:text-brand">
            {t.nav.start}
          </a>
          <span aria-hidden="true">•</span>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-brand" dir="ltr">
            {CONTACT_EMAIL}
          </a>
        </div>
      </div>
    </footer>
  );
}
