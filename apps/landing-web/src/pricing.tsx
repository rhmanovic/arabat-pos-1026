import {
  type BusinessType,
  BUSINESS_TYPES,
  type PublicOffer,
  type PublicOfferItem,
  type PublicTrialOffer,
  type TrialStarted,
} from '@arabat/contracts';
import { Money } from '@arabat/money';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { type Content, type Language } from './content.js';
import { ItemIllustration } from './illustrations.js';
import {
  Footer,
  Header,
  SIGN_IN_URL,
  outlineButton,
  primaryButton,
  useLanguage,
  useTrialOffer,
} from './layout.js';
import { Reveal } from './reveal.js';
import { SystemCard } from './system-card.js';
import { TrialDone, postTrial, trialSessionId } from './trial.js';

const CURRENCY = 'KWD' as const;
type Step = 0 | 1 | 2 | 3;
type Quantities = Record<string, number>;
/** The request form; kept by the configurator so going back to the devices keeps what was typed. */
const BUSINESS_ICON: Record<BusinessType, string> = {
  retail: '🛍️',
  restaurant: '🍽️',
  cafe: '☕',
  other: '✨',
};
type Contact = {
  businessType: BusinessType | null;
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  password: string;
};
const EMPTY_CONTACT: Contact = {
  businessType: null,
  companyName: '',
  contactName: '',
  phone: '',
  email: '',
  password: '',
};

/** "99.000" → "99", "45.500" → "45.500": display only, never used for arithmetic. */
const short = (amount: string) => amount.replace(/\.000$/, '');
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

/** Totals for display, in exact fils (the server prices the request again on its own). */
function totals(offer: PublicOffer, quantities: Quantities) {
  const system = Money.parse(offer.system.price.amount, CURRENCY);
  let devices = Money.zero(CURRENCY);
  let count = 0;
  for (const item of offer.devices) {
    const quantity = quantities[item.id] ?? 0;
    if (quantity <= 0) continue;
    devices = devices.add(Money.parse(item.price.amount, CURRENCY).multiply(String(quantity)));
    count += quantity;
  }
  return {
    system: system.toDecimalString(),
    devices: devices.toDecimalString(),
    total: system.add(devices).toDecimalString(),
    count,
  };
}

export function PricingPage() {
  const { lang, t, toggleLanguage } = useLanguage((c) => c.pricing.pageTitle);
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [failed, setFailed] = useState(false);
  const trial = useTrialOffer();
  /** Once the account is open only the congratulations card stays on the page. */
  const [started, setStarted] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/v1/public/pricing', { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as PublicOffer;
        if (active) setOffer(data);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <Header t={t} onToggleLanguage={toggleLanguage} page="pricing" />
      <main className="flex-1">
        {started ? null : <PricingHero t={t} offer={offer} lang={lang} />}
        <section id="configure" className="bg-sand py-14 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            {offer ? (
              <Configurator
                t={t}
                offer={offer}
                trial={trial}
                lang={lang}
                onStarted={() => setStarted(true)}
              />
            ) : (
              <p
                className="py-20 text-center text-lg text-muted"
                role={failed ? 'alert' : 'status'}
              >
                {failed ? t.pricing.loadError : t.pricing.loading}
              </p>
            )}
          </div>
        </section>
      </main>
      <Footer t={t} page="pricing" />
    </div>
  );
}

function PricingHero({
  t,
  offer,
  lang,
}: {
  t: Content;
  offer: PublicOffer | null;
  lang: Language;
}) {
  const p = t.pricing;
  return (
    <section className="relative overflow-hidden bg-brand-soft">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:py-20">
        <div>
          <Reveal as="p" className="font-semibold text-accent-red">
            {p.lead}
          </Reveal>
          <Reveal as="h1" delay={0.1} className="mt-2 text-4xl font-bold leading-tight sm:text-5xl">
            {p.title}
          </Reveal>
          <Reveal as="p" delay={0.2} className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
            {p.subtitle}
          </Reveal>
        </div>
        <Reveal direction="end" delay={0.2} className="flex justify-center lg:justify-end">
          <div className="float relative w-full max-w-sm overflow-hidden rounded-3xl bg-brand p-8 text-white shadow-2xl shadow-brand/30">
            <img
              src="/img/logo-mark.webp"
              alt=""
              className="pointer-events-none absolute -start-14 -bottom-14 w-44 opacity-15"
            />
            <p className="text-white/85">
              {offer ? (lang === 'ar' ? offer.system.nameAr : offer.system.nameEn) : '…'}
            </p>
            <p className="mt-3 flex items-baseline gap-2" dir="ltr">
              <span className="text-6xl font-bold tabular-nums">
                {offer ? short(offer.system.price.amount) : '—'}
              </span>
              <span className="text-xl">{p.currency}</span>
            </p>
            <p className="mt-1 text-lg">{p.perYear}</p>
            <p className="mt-4 text-sm text-white/85">{p.perCompany}</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Stepper({ t, step }: { t: Content; step: Step }) {
  return (
    <ol
      className="flex items-center gap-2 sm:gap-4"
      aria-label={fill(t.pricing.stepLabel, { n: Math.min(step, 2) + 1 })}
    >
      {t.pricing.steps.map((label, index) => {
        const done = step > index;
        const current = step === index;
        return (
          <li key={label} className="flex flex-1 items-center gap-2 sm:gap-3">
            <span
              aria-current={current ? 'step' : undefined}
              className={`grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold transition ${
                done || current
                  ? 'bg-brand text-white shadow-md shadow-brand/30'
                  : 'bg-white text-muted ring-1 ring-black/10'
              }`}
            >
              {done ? '✓' : index + 1}
            </span>
            <span
              className={`text-sm sm:text-base ${current ? 'font-bold text-ink' : 'text-muted'}`}
            >
              {label}
            </span>
            {index < 2 ? (
              <span className={`h-0.5 flex-1 rounded-full ${done ? 'bg-brand' : 'bg-black/10'}`} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Configurator({
  t,
  offer,
  trial,
  lang,
  onStarted,
}: {
  t: Content;
  offer: PublicOffer;
  trial: PublicTrialOffer | null;
  lang: Language;
  onStarted: () => void;
}) {
  const [step, setStep] = useState<Step>(0);
  const [quantities, setQuantities] = useState<Quantities>({});
  const [contact, setContact] = useState<Contact>(EMPTY_CONTACT);
  const [started, setStarted] = useState<TrialStarted | null>(null);
  const [session] = useState(trialSessionId);
  const top = useRef<HTMLDivElement>(null);
  const sum = useMemo(() => totals(offer, quantities), [offer, quantities]);
  /** Trial length set in the platform: longer or shorter when devices are chosen. */
  const trialDays = !trial ? null : sum.count ? trial.trialDaysDevices : trial.trialDaysOwn;

  const go = (next: Step) => {
    setStep(next);
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  /** The business type is chosen first, on the system step (owner, 2026-10-18). */
  const [needBusiness, setNeedBusiness] = useState(false);
  const fromSystem = () => {
    if (contact.businessType) return go(1);
    setNeedBusiness(true);
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const setQuantity = (item: PublicOfferItem, quantity: number) =>
    setQuantities((q) => ({ ...q, [item.id]: Math.max(0, Math.min(item.maxQuantity, quantity)) }));

  if (step === 3 && started) return <TrialDone t={t} result={started} />;

  return (
    <div ref={top} className="scroll-mt-24">
      <div className="mx-auto max-w-3xl">
        <Stepper t={t} step={step} />
      </div>
      <div className="mt-10 grid gap-8 lg:grid-cols-3">
        <div key={step} className="step-in lg:col-span-2">
          {step === 0 ? (
            <div className="space-y-6">
              <BusinessPicker
                t={t}
                value={contact.businessType}
                missing={needBusiness}
                onPick={(type) => {
                  setContact((c) => ({ ...c, businessType: type }));
                  setNeedBusiness(false);
                }}
              />
              <SystemStep t={t} offer={offer} lang={lang} onNext={fromSystem} />
            </div>
          ) : null}
          {step === 1 ? (
            <DevicesStep
              t={t}
              offer={offer}
              lang={lang}
              quantities={quantities}
              setQuantity={setQuantity}
              onBack={() => go(0)}
              onNext={() => go(2)}
            />
          ) : null}
          {step === 2 ? (
            <RequestStep
              t={t}
              offer={offer}
              lang={lang}
              quantities={quantities}
              session={session}
              contact={contact}
              setContact={setContact}
              onBack={() => go(1)}
              onDone={(result) => {
                setStarted(result);
                onStarted();
                go(3);
              }}
            />
          ) : null}
        </div>
        <Cart
          t={t}
          offer={offer}
          lang={lang}
          quantities={quantities}
          sum={sum}
          trialDays={trialDays}
        />
      </div>
    </div>
  );
}

function BusinessPicker({
  t,
  value,
  missing,
  onPick,
}: {
  t: Content;
  value: BusinessType | null;
  missing: boolean;
  onPick: (type: BusinessType) => void;
}) {
  const f = t.pricing.form;
  return (
    <fieldset
      className={`rounded-3xl bg-white p-6 shadow-sm ring-2 transition sm:p-8 ${
        missing ? 'ring-coral' : 'ring-transparent'
      }`}
    >
      <legend className="sr-only">{f.business}</legend>
      <h2 className="text-xl font-bold sm:text-2xl">{f.business}</h2>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {BUSINESS_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onPick(type)}
            aria-pressed={value === type}
            className={`flex flex-col items-center gap-2 rounded-2xl p-4 font-bold text-ink ring-2 transition hover:-translate-y-0.5 ${
              value === type
                ? 'bg-brand-soft ring-brand'
                : 'bg-sand ring-transparent hover:ring-brand/40'
            }`}
          >
            <span
              className="grid size-12 place-items-center rounded-full bg-white text-2xl shadow-sm"
              aria-hidden="true"
            >
              {BUSINESS_ICON[type]}
            </span>
            {f.businessTypes[type]}
          </button>
        ))}
      </div>
      {missing ? (
        <p role="alert" className="mt-4 text-sm font-medium text-coral">
          {f.pickBusiness}
        </p>
      ) : null}
    </fieldset>
  );
}

function SystemStep({
  t,
  offer,
  lang,
  onNext,
}: {
  t: Content;
  offer: PublicOffer;
  lang: Language;
  onNext: () => void;
}) {
  const p = t.pricing;
  const system = offer.system;
  return (
    <SystemCard
      title={p.system.title}
      text={(lang === 'ar' ? system.descriptionAr : system.descriptionEn) ?? p.system.text}
      price={null}
      currency={p.currency}
      perYear={p.perYear}
      includes={p.system.includes}
      icon={system.icon}
      imageUrl={system.imageUrl}
      badge={p.system.included}
      action={
        <button type="button" onClick={onNext} className={primaryButton}>
          {p.system.next}
        </button>
      }
    />
  );
}

function DevicesStep({
  t,
  offer,
  lang,
  quantities,
  setQuantity,
  onBack,
  onNext,
}: {
  t: Content;
  offer: PublicOffer;
  lang: Language;
  quantities: Quantities;
  setQuantity: (item: PublicOfferItem, quantity: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const p = t.pricing;
  const any = Object.values(quantities).some((q) => q > 0);
  return (
    <div>
      <div className="rounded-3xl bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-2xl font-bold sm:text-3xl">{p.devices.title}</h2>
        <p className="mt-2 text-muted">{p.devices.text}</p>
        <p className="mt-3 text-sm text-brand">{p.devices.worksWith}</p>
      </div>
      {offer.devices.length === 0 ? (
        <p className="mt-6 rounded-3xl bg-white p-8 text-center text-muted shadow-sm">
          {p.devices.empty}
        </p>
      ) : (
        <ul className="mt-6 grid gap-5 sm:grid-cols-2">
          {offer.devices.map((item, index) => {
            const quantity = quantities[item.id] ?? 0;
            const name = lang === 'ar' ? item.nameAr : item.nameEn;
            const description = lang === 'ar' ? item.descriptionAr : item.descriptionEn;
            return (
              <Reveal
                as="li"
                key={item.id}
                delay={(index % 2) * 0.1}
                className={`flex flex-col rounded-3xl bg-white p-5 shadow-sm ring-2 transition ${
                  quantity > 0
                    ? 'ring-brand shadow-lg shadow-brand/10'
                    : 'ring-transparent hover:shadow-md'
                }`}
              >
                <div className="flex items-center gap-4">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      loading="lazy"
                      className="size-24 shrink-0 rounded-2xl object-cover"
                    />
                  ) : (
                    <ItemIllustration icon={item.icon} className="size-24 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold">{name}</h3>
                    {description ? (
                      <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
                    ) : null}
                    <p className="mt-2 font-bold tabular-nums text-ink">
                      <span dir="ltr">
                        {item.price.amount} {p.currency}
                      </span>{' '}
                      <span className="text-sm font-normal text-muted">{p.once}</span>
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex items-center justify-between gap-3">
                  {quantity === 0 ? (
                    <button
                      type="button"
                      onClick={() => setQuantity(item, 1)}
                      className="w-full rounded-full border-2 border-brand py-2.5 font-medium text-brand transition hover:bg-brand hover:text-white"
                    >
                      + {p.devices.add}
                    </button>
                  ) : (
                    <>
                      <span className="text-sm font-medium text-brand">✓ {p.devices.added}</span>
                      <span className="flex items-center gap-2" dir="ltr">
                        <button
                          type="button"
                          aria-label={`${p.devices.decrease} ${name}`}
                          onClick={() => setQuantity(item, quantity - 1)}
                          className="grid size-10 place-items-center rounded-full bg-sand text-xl font-bold text-ink transition hover:bg-brand-soft"
                        >
                          −
                        </button>
                        <span
                          className="w-8 text-center text-lg font-bold tabular-nums"
                          aria-live="polite"
                        >
                          {quantity}
                        </span>
                        <button
                          type="button"
                          aria-label={`${p.devices.increase} ${name}`}
                          disabled={quantity >= item.maxQuantity}
                          title={fill(p.devices.max, { n: item.maxQuantity })}
                          onClick={() => setQuantity(item, quantity + 1)}
                          className="grid size-10 place-items-center rounded-full bg-brand text-xl font-bold text-white transition hover:bg-brand-dark disabled:opacity-40"
                        >
                          +
                        </button>
                      </span>
                    </>
                  )}
                </div>
              </Reveal>
            );
          })}
        </ul>
      )}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="px-2 py-2 text-muted hover:text-brand">
          {p.devices.back}
        </button>
        <div className="flex flex-wrap gap-3">
          {any ? null : (
            <button type="button" onClick={onNext} className={outlineButton}>
              {p.devices.skip}
            </button>
          )}
          {any ? (
            <button type="button" onClick={onNext} className={primaryButton}>
              {p.devices.next}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RequestStep({
  t,
  offer,
  lang,
  quantities,
  session,
  contact,
  setContact,
  onBack,
  onDone,
}: {
  t: Content;
  offer: PublicOffer;
  lang: Language;
  quantities: Quantities;
  session: string;
  contact: Contact;
  setContact: (update: (c: Contact) => Contact) => void;
  onBack: () => void;
  onDone: (started: TrialStarted) => void;
}) {
  const f = t.pricing.form;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<
    'business' | 'taken' | 'unavailable' | 'rate' | 'other' | null
  >(null);
  const setField = (field: Exclude<keyof Contact, 'businessType'>, value: string) =>
    setContact((c) => ({ ...c, [field]: value }));

  /** Opens the trial account straight away, like /start (ADR-0115 amendment 3). */
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!contact.businessType) return setError('business');
    setSending(true);
    setError(null);
    const r = await postTrial<TrialStarted>('start', {
      businessType: contact.businessType,
      fullName: contact.contactName,
      email: contact.email,
      password: contact.password,
      companyName: contact.companyName,
      phone: contact.phone,
      language: lang,
      sessionId: session,
      devices: offer.devices
        .filter((item) => (quantities[item.id] ?? 0) > 0)
        .map((item) => ({ itemId: item.id, quantity: quantities[item.id] })),
    });
    setSending(false);
    if (r.ok) return onDone(r.data);
    if (r.code === 'EMAIL_ALREADY_REGISTERED') setError('taken');
    else if (r.issue === 'unavailable') setError('unavailable');
    else if (r.status === 429) setError('rate');
    else setError('other');
  };

  const input =
    'mt-1.5 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/15';
  return (
    <form onSubmit={(e) => void submit(e)} className="rounded-3xl bg-white p-6 shadow-sm sm:p-10">
      <h2 className="text-2xl font-bold sm:text-3xl">{f.title}</h2>
      <p className="mt-2 text-muted">{f.text}</p>
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-ink">{f.company}</span>
          <input
            name="companyName"
            value={contact.companyName}
            onChange={(e) => setField('companyName', e.target.value)}
            maxLength={120}
            autoComplete="organization"
            className={input}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">{f.contact}</span>
          <input
            name="contactName"
            value={contact.contactName}
            onChange={(e) => setField('contactName', e.target.value)}
            required
            minLength={2}
            maxLength={120}
            autoComplete="name"
            className={input}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">{f.phone}</span>
          <input
            name="phone"
            value={contact.phone}
            onChange={(e) => setField('phone', e.target.value)}
            type="tel"
            required
            pattern="[+]?[0-9\s\(\)\-]{7,20}"
            autoComplete="tel"
            dir="ltr"
            placeholder="+965"
            className={`${input} text-start`}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">{f.email}</span>
          <input
            name="email"
            value={contact.email}
            onChange={(e) => setField('email', e.target.value)}
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            dir="ltr"
            className={`${input} text-start`}
          />
        </label>
        <div className="sm:col-span-2">
          <label className="block">
            <span className="text-sm font-medium text-ink">{f.password}</span>
            <input
              name="password"
              type="password"
              value={contact.password}
              onChange={(e) => setField('password', e.target.value)}
              required
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
              dir="ltr"
              aria-describedby="pricing-password-hint"
              className={`${input} text-start`}
            />
          </label>
          <span id="pricing-password-hint" className="mt-1 block text-xs text-muted">
            {f.passwordHint}
          </span>
        </div>
      </div>
      <p className="mt-6 flex items-start gap-2 rounded-2xl bg-brand-soft px-4 py-3 text-sm text-brand">
        <span aria-hidden="true">🔒</span>
        {f.noPayment}
      </p>
      {error ? (
        <p role="alert" className="mt-4 rounded-2xl bg-coral/10 px-4 py-3 text-sm text-coral">
          {error === 'business' ? (
            f.pickBusiness
          ) : error === 'taken' ? (
            <>
              {f.emailTaken}{' '}
              <a href={SIGN_IN_URL} className="font-bold underline">
                {f.signIn}
              </a>
            </>
          ) : error === 'unavailable' ? (
            f.unavailable
          ) : error === 'rate' ? (
            f.rateLimited
          ) : (
            f.error
          )}
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="px-2 py-2 text-muted hover:text-brand">
          {f.back}
        </button>
        <button type="submit" disabled={sending} className={`${primaryButton} disabled:opacity-60`}>
          {sending ? f.sending : f.submit}
        </button>
      </div>
    </form>
  );
}

function Cart({
  t,
  offer,
  lang,
  quantities,
  sum,
  trialDays,
}: {
  t: Content;
  offer: PublicOffer;
  lang: Language;
  quantities: Quantities;
  sum: ReturnType<typeof totals>;
  trialDays: number | null;
}) {
  const c = t.pricing.cart;
  const p = t.pricing;
  const chosen = offer.devices.filter((item) => (quantities[item.id] ?? 0) > 0);
  return (
    <aside className="hidden lg:block">
      <div className="sticky top-24 rounded-3xl bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold">{c.title}</h3>
        {/* The price shows once here; the itemised lines appear only when devices are chosen. */}
        {chosen.length ? (
          <ul className="mt-4 space-y-3 text-sm">
            <li className="flex items-start justify-between gap-3">
              <span className="text-ink">
                {lang === 'ar' ? offer.system.nameAr : offer.system.nameEn}
              </span>
              <span className="tabular-nums" dir="ltr">
                {offer.system.price.amount}
              </span>
            </li>
            {chosen.map((item) => (
              <li key={item.id} className="cart-line flex items-start justify-between gap-3">
                <span className="text-ink">
                  {lang === 'ar' ? item.nameAr : item.nameEn}{' '}
                  <span className="text-muted">× {quantities[item.id]}</span>
                </span>
                <span className="tabular-nums" dir="ltr">
                  {Money.parse(item.price.amount, CURRENCY)
                    .multiply(String(quantities[item.id]))
                    .toDecimalString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">{c.noDevices}</p>
        )}
        <div className="mt-4 rounded-2xl bg-brand p-4 text-white">
          <p className="text-sm text-white/85">{c.firstPayment}</p>
          <p key={sum.total} className="bump text-3xl font-bold tabular-nums" dir="ltr">
            {sum.total} <span className="text-base">{p.currency}</span>
          </p>
          {chosen.length ? (
            <p className="mt-1 text-xs text-white/80">{fill(c.renewal, { amount: sum.system })}</p>
          ) : null}
        </div>
        {trialDays ? (
          <p
            key={trialDays}
            className="bump mt-3 rounded-full bg-brand-soft px-4 py-1.5 text-center text-sm font-medium text-brand"
          >
            ✓ {fill(t.trialLine, { length: t.trialLength(trialDays) })}
          </p>
        ) : null}
      </div>
    </aside>
  );
}
