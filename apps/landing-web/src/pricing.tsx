import type { PublicOffer, PublicOfferItem, SalesRequestCreated } from '@arabat/contracts';
import { Money } from '@arabat/money';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CONTACT_EMAIL, type Content, type Language } from './content.js';
import { ItemIllustration } from './illustrations.js';
import {
  Footer,
  Header,
  REGISTER_URL,
  outlineButton,
  primaryButton,
  useLanguage,
} from './layout.js';
import { Reveal } from './reveal.js';

const CURRENCY = 'KWD' as const;
type Step = 0 | 1 | 2 | 3;
type Quantities = Record<string, number>;
/** The request form; kept by the configurator so going back to the devices keeps what was typed. */
type Contact = {
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  notes: string;
};
const EMPTY_CONTACT: Contact = {
  companyName: '',
  contactName: '',
  phone: '',
  email: '',
  notes: '',
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
        <PricingHero t={t} offer={offer} lang={lang} />
        <section id="configure" className="bg-sand py-14 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            {offer ? (
              <Configurator t={t} offer={offer} lang={lang} />
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
        <Faq t={t} />
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
    <section className="relative overflow-hidden">
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
            <a
              href="#configure"
              className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-white px-6 py-3 font-medium text-brand transition hover:-translate-y-0.5"
            >
              {p.system.next}
            </a>
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

function Configurator({ t, offer, lang }: { t: Content; offer: PublicOffer; lang: Language }) {
  const p = t.pricing;
  const [step, setStep] = useState<Step>(0);
  const [quantities, setQuantities] = useState<Quantities>({});
  const [contact, setContact] = useState<Contact>(EMPTY_CONTACT);
  const [created, setCreated] = useState<SalesRequestCreated | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const sum = useMemo(() => totals(offer, quantities), [offer, quantities]);

  const go = (next: Step) => {
    setStep(next);
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const setQuantity = (item: PublicOfferItem, quantity: number) =>
    setQuantities((q) => ({ ...q, [item.id]: Math.max(0, Math.min(item.maxQuantity, quantity)) }));

  if (step === 3 && created)
    return (
      <Done
        t={t}
        created={created}
        onAgain={() => {
          setQuantities({});
          setContact(EMPTY_CONTACT);
          setCreated(null);
          go(0);
        }}
      />
    );

  return (
    <div ref={top} className="scroll-mt-24">
      <div className="mx-auto max-w-3xl">
        <Stepper t={t} step={step} />
      </div>
      <div className="mt-10 grid gap-8 lg:grid-cols-3">
        <div key={step} className="step-in lg:col-span-2">
          {step === 0 ? <SystemStep t={t} offer={offer} lang={lang} onNext={() => go(1)} /> : null}
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
              contact={contact}
              setContact={setContact}
              onBack={() => go(1)}
              onDone={(result) => {
                setCreated(result);
                go(3);
              }}
            />
          ) : null}
        </div>
        <Cart t={t} offer={offer} lang={lang} quantities={quantities} sum={sum} />
      </div>
      {/* Phones: the running total stays in view while choosing. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-black/5 bg-white/95 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted">{p.cart.firstPayment}</p>
            <p className="text-xl font-bold tabular-nums text-ink" dir="ltr">
              {sum.total} <span className="text-sm text-muted">{p.currency}</span>
            </p>
          </div>
          {step < 2 ? (
            <button
              type="button"
              onClick={() => go((step + 1) as Step)}
              className="rounded-full bg-brand px-5 py-2.5 font-medium text-white"
            >
              {step === 0 ? p.system.next : p.devices.next}
            </button>
          ) : null}
        </div>
      </div>
    </div>
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
    <div className="rounded-3xl bg-white p-6 shadow-sm sm:p-10">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        {system.imageUrl ? (
          <img src={system.imageUrl} alt="" className="size-28 rounded-2xl object-cover" />
        ) : (
          <ItemIllustration icon={system.icon} className="size-28 shrink-0" />
        )}
        <div className="flex-1">
          <h2 className="text-2xl font-bold sm:text-3xl">{p.system.title}</h2>
          <p className="mt-2 text-muted">
            {(lang === 'ar' ? system.descriptionAr : system.descriptionEn) ?? p.system.text}
          </p>
        </div>
        <div className="text-start sm:text-end">
          <p className="text-3xl font-bold tabular-nums text-brand" dir="ltr">
            {short(system.price.amount)} <span className="text-base">{p.currency}</span>
          </p>
          <p className="text-sm text-muted">{p.perYear}</p>
        </div>
      </div>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {p.system.includes.map((line, index) => (
          <Reveal as="li" key={line} delay={index * 0.05} className="flex items-start gap-3">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-sm text-brand">
              ✓
            </span>
            <span className="text-ink">{line}</span>
          </Reveal>
        ))}
      </ul>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-black/5 pt-6">
        <span className="rounded-full bg-brand-soft px-4 py-1.5 text-sm font-medium text-brand">
          ✓ {p.system.included}
        </span>
        <button type="button" onClick={onNext} className={primaryButton}>
          {p.system.next}
        </button>
      </div>
    </div>
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
  contact,
  setContact,
  onBack,
  onDone,
}: {
  t: Content;
  offer: PublicOffer;
  lang: Language;
  quantities: Quantities;
  contact: Contact;
  setContact: (update: (c: Contact) => Contact) => void;
  onBack: () => void;
  onDone: (created: SalesRequestCreated) => void;
}) {
  const f = t.pricing.form;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setField = (field: keyof Contact, value: string) =>
    setContact((c) => ({ ...c, [field]: value }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/public/pricing/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          ...contact,
          language: lang,
          devices: offer.devices
            .filter((item) => (quantities[item.id] ?? 0) > 0)
            .map((item) => ({ itemId: item.id, quantity: quantities[item.id] })),
        }),
      });
      if (response.ok) {
        onDone((await response.json()) as SalesRequestCreated);
        return;
      }
      const problem = (await response.json().catch(() => null)) as {
        issues?: { code?: string }[];
      } | null;
      if (response.status === 429) setError(f.rateLimited);
      else if (problem?.issues?.some((i) => i.code === 'unavailable' || i.code === 'too_many'))
        setError(f.unavailable);
      else setError(f.error);
    } catch {
      setError(f.error);
    } finally {
      setSending(false);
    }
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
            required
            minLength={2}
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
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium text-ink">{f.notes}</span>
          <textarea
            name="notes"
            value={contact.notes}
            onChange={(e) => setField('notes', e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={f.notesPlaceholder}
            className={input}
          />
        </label>
      </div>
      <p className="mt-6 flex items-start gap-2 rounded-2xl bg-brand-soft px-4 py-3 text-sm text-brand">
        <span aria-hidden="true">🔒</span>
        {f.noPayment}
      </p>
      {error ? (
        <p role="alert" className="mt-4 rounded-2xl bg-coral/10 px-4 py-3 text-sm text-coral">
          {error}
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
}: {
  t: Content;
  offer: PublicOffer;
  lang: Language;
  quantities: Quantities;
  sum: ReturnType<typeof totals>;
}) {
  const c = t.pricing.cart;
  const p = t.pricing;
  const chosen = offer.devices.filter((item) => (quantities[item.id] ?? 0) > 0);
  return (
    <aside className="hidden lg:block">
      <div className="sticky top-24 rounded-3xl bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold">{c.title}</h3>
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
          {chosen.length === 0 ? <li className="text-muted">{c.noDevices}</li> : null}
        </ul>
        <dl className="mt-5 space-y-2 border-t border-black/5 pt-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{c.system}</dt>
            <dd className="tabular-nums" dir="ltr">
              {sum.system}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">
              {c.devices}
              {sum.count ? ` · ${fill(c.items, { n: sum.count })}` : ''}
            </dt>
            <dd className="tabular-nums" dir="ltr">
              {sum.devices}
            </dd>
          </div>
        </dl>
        <div className="mt-4 rounded-2xl bg-brand p-4 text-white">
          <p className="text-sm text-white/85">{c.firstPayment}</p>
          <p key={sum.total} className="bump text-3xl font-bold tabular-nums" dir="ltr">
            {sum.total} <span className="text-base">{p.currency}</span>
          </p>
          <p className="mt-1 text-xs text-white/80">{fill(c.renewal, { amount: sum.system })}</p>
        </div>
      </div>
    </aside>
  );
}

function Done({
  t,
  created,
  onAgain,
}: {
  t: Content;
  created: SalesRequestCreated;
  onAgain: () => void;
}) {
  const d = t.pricing.done;
  return (
    <div className="step-in mx-auto max-w-2xl rounded-3xl bg-white p-8 text-center shadow-sm sm:p-12">
      <span className="pop mx-auto grid size-20 place-items-center rounded-full bg-brand text-4xl text-white shadow-lg shadow-brand/30">
        ✓
      </span>
      <h2 className="mt-6 text-3xl font-bold">{d.title}</h2>
      <p className="mt-3 text-lg leading-relaxed text-muted">
        {fill(d.text, { ref: created.reference })}
      </p>
      <p className="mt-6 text-2xl font-bold tabular-nums text-ink" dir="ltr">
        {created.total.amount} <span className="text-base text-muted">{t.pricing.currency}</span>
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <a href={REGISTER_URL} className={primaryButton}>
          {t.hero.primary}
        </a>
        <button type="button" onClick={onAgain} className={outlineButton}>
          {d.again}
        </button>
      </div>
      <p className="mt-6 text-sm text-muted">
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand" dir="ltr">
          {CONTACT_EMAIL}
        </a>
      </p>
    </div>
  );
}

function Faq({ t }: { t: Content }) {
  const faq = t.pricing.faq;
  return (
    <section className="mx-auto max-w-3xl px-4 py-20 pb-28 sm:px-6 lg:pb-20">
      <Reveal as="h2" className="text-center text-3xl font-bold sm:text-4xl">
        {faq.title}
      </Reveal>
      <div className="mt-10 space-y-3">
        {faq.items.map((item, index) => (
          <Reveal key={item.q} delay={index * 0.08}>
            <details className="group rounded-2xl bg-sand p-5 open:bg-brand-soft">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold text-ink">
                {item.q}
                <span className="text-xl text-brand transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 leading-relaxed text-muted">{item.a}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
