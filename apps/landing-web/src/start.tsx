import {
  type BusinessType,
  type FunnelStep,
  type PublicTrialOffer,
  type TrialStarted,
  BUSINESS_TYPES,
} from '@arabat/contracts';
import { Money } from '@arabat/money';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { CONTACT_EMAIL, type Content, type Language } from './content.js';
import { ItemIllustration } from './illustrations.js';
import { Footer, Header, SIGN_IN_URL, primaryButton, useLanguage } from './layout.js';
import { Reveal } from './reveal.js';

const CURRENCY = 'KWD' as const;
type Step = 0 | 1 | 2 | 3;
type Quantities = Record<string, number>;
type Account = { fullName: string; email: string; password: string; company: string };
const BUSINESS_ICON: Record<BusinessType, string> = {
  retail: '🛍️',
  restaurant: '🍽️',
  cafe: '☕',
  other: '✨',
};
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
const input =
  'mt-1.5 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/15';

/** Anonymous id of this visit, so the funnel counts steps without personal data. */
function sessionId(): string {
  const make = () => crypto.randomUUID();
  try {
    const saved = sessionStorage.getItem('arabat.funnel');
    if (saved) return saved;
    const id = make();
    sessionStorage.setItem('arabat.funnel', id);
    return id;
  } catch {
    return make();
  }
}

async function post<T>(
  path: string,
  body: unknown,
): Promise<{ ok: true; data: T } | { ok: false; status: number; code?: string; issue?: string }> {
  try {
    const response = await fetch(`/api/v1/public/trial/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok)
      return { ok: true, data: (response.status === 204 ? null : await response.json()) as T };
    const problem = (await response.json().catch(() => null)) as {
      code?: string;
      issues?: { code?: string }[];
    } | null;
    return {
      ok: false,
      status: response.status,
      ...(problem?.code ? { code: problem.code } : {}),
      ...(problem?.issues?.[0]?.code ? { issue: problem.issues[0].code } : {}),
    };
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * The free-trial funnel (ADR-0115): business → devices (pick, or skip) → account. The account
 * opens at once; no e-mail confirmation in this phase (owner, 2026-10-18).
 */
export function StartPage() {
  const { lang, t, toggleLanguage } = useLanguage((c) => c.start.pageTitle);
  const s = t.start;
  const [session] = useState(sessionId);
  const [offer, setOffer] = useState<PublicTrialOffer | null>(null);
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState<Step>(0);
  const [business, setBusiness] = useState<BusinessType | null>(null);
  const [quantities, setQuantities] = useState<Quantities>({});
  const [account, setAccount] = useState<Account>({
    fullName: '',
    email: '',
    password: '',
    company: '',
  });
  const [result, setResult] = useState<TrialStarted | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/v1/public/trial', { headers: { accept: 'application/json' } })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        setOffer((await r.json()) as PublicTrialOffer);
      })
      .catch(() => setFailed(true));
  }, []);

  const track = (name: FunnelStep) => void post('events', { sessionId: session, step: name });
  const go = (next: Step) => {
    setStep(next);
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const chosen = offer ? offer.devices.filter((d) => (quantities[d.id] ?? 0) > 0) : [];
  const trialDays = !offer ? 0 : chosen.length ? offer.trialDaysDevices : offer.trialDaysOwn;

  return (
    <div className="flex min-h-screen flex-col">
      <Header t={t} onToggleLanguage={toggleLanguage} page="start" />
      <main className="flex-1 bg-sand py-10 sm:py-14">
        <div ref={top} className="mx-auto max-w-7xl scroll-mt-24 px-4 sm:px-6">
          {!offer ? (
            <p className="py-20 text-center text-lg text-muted" role={failed ? 'alert' : 'status'}>
              {failed ? s.loadError : s.loading}
            </p>
          ) : step === 3 && result ? (
            <Done t={t} result={result} />
          ) : (
            <>
              <div className="mx-auto max-w-3xl">
                <Stepper t={t} step={step} />
              </div>
              <div className="mt-10 grid gap-8 lg:grid-cols-3">
                <div key={step} className="step-in lg:col-span-2">
                  {step === 0 ? (
                    <BusinessStep
                      t={t}
                      selected={business}
                      onPick={(type) => {
                        setBusiness(type);
                        track('business');
                        track('devices');
                        go(1);
                      }}
                    />
                  ) : null}
                  {step === 1 ? (
                    <DevicesStep
                      t={t}
                      lang={lang}
                      offer={offer}
                      quantities={quantities}
                      setQuantities={setQuantities}
                      onBack={() => go(0)}
                      onNext={() => go(2)}
                      onSkip={() => {
                        setQuantities({});
                        go(2);
                      }}
                    />
                  ) : null}
                  {step === 2 && business ? (
                    <AccountStep
                      t={t}
                      lang={lang}
                      business={business}
                      session={session}
                      account={account}
                      setAccount={setAccount}
                      trialDays={trialDays}
                      devices={chosen.map((d) => ({ itemId: d.id, quantity: quantities[d.id]! }))}
                      onBack={() => go(1)}
                      onStarted={(started) => {
                        setResult(started);
                        go(3);
                      }}
                    />
                  ) : null}
                </div>
                <Summary
                  t={t}
                  lang={lang}
                  offer={offer}
                  quantities={quantities}
                  trialDays={trialDays}
                />
              </div>
            </>
          )}
        </div>
      </main>
      <Footer t={t} page="start" />
    </div>
  );
}

function Stepper({ t, step }: { t: Content; step: Step }) {
  return (
    <ol className="flex items-center gap-2 sm:gap-4">
      {t.start.steps.map((label, index) => {
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
            {index < t.start.steps.length - 1 ? (
              <span className={`h-0.5 flex-1 rounded-full ${done ? 'bg-brand' : 'bg-black/10'}`} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function BusinessStep({
  t,
  selected,
  onPick,
}: {
  t: Content;
  selected: BusinessType | null;
  onPick: (type: BusinessType) => void;
}) {
  const b = t.start.business;
  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm sm:p-10">
      <h1 className="text-2xl font-bold sm:text-3xl">{b.title}</h1>
      <p className="mt-2 text-muted">{b.text}</p>
      <div className="mt-8 grid grid-cols-2 gap-4">
        {BUSINESS_TYPES.map((type, index) => (
          <Reveal key={type} delay={index * 0.05}>
            <button
              type="button"
              onClick={() => onPick(type)}
              aria-pressed={selected === type}
              className={`flex w-full flex-col items-center gap-3 rounded-2xl p-6 text-lg font-bold text-ink ring-2 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand/10 ${
                selected === type
                  ? 'bg-brand-soft ring-brand'
                  : 'bg-sand ring-transparent hover:ring-brand/40'
              }`}
            >
              <span
                className="grid size-16 place-items-center rounded-full bg-white text-3xl shadow-sm"
                aria-hidden="true"
              >
                {BUSINESS_ICON[type]}
              </span>
              {b.types[type]}
            </button>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

function DevicesStep({
  t,
  lang,
  offer,
  quantities,
  setQuantities,
  onBack,
  onNext,
  onSkip,
}: {
  t: Content;
  lang: Language;
  offer: PublicTrialOffer;
  quantities: Quantities;
  setQuantities: (update: (q: Quantities) => Quantities) => void;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const d = t.start.devices;
  const chosen = offer.devices.filter((x) => (quantities[x.id] ?? 0) > 0);
  const waitlisted = chosen.some((x) => !x.available);
  const set = (id: string, max: number, quantity: number) =>
    setQuantities((q) => ({ ...q, [id]: Math.max(0, Math.min(max, quantity)) }));
  return (
    <div>
      <div className="rounded-3xl bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold sm:text-3xl">{d.title}</h1>
        <p className="mt-2 text-muted">{d.text}</p>
        <p className="mt-3 text-sm text-brand">{d.worksWith}</p>
      </div>
      {offer.devices.length === 0 ? (
        <p className="mt-6 rounded-3xl bg-white p-8 text-center text-muted shadow-sm">{d.none}</p>
      ) : (
        <ul className="mt-6 grid gap-5 sm:grid-cols-2">
          {offer.devices.map((item, index) => {
            const quantity = quantities[item.id] ?? 0;
            const name = lang === 'ar' ? item.nameAr : item.nameEn;
            const description = lang === 'ar' ? item.descriptionAr : item.descriptionEn;
            const blocked = !item.available && !offer.waitlistEnabled;
            return (
              <Reveal
                as="li"
                key={item.id}
                delay={(index % 2) * 0.1}
                className={`flex flex-col rounded-3xl bg-white p-5 shadow-sm ring-2 transition ${
                  quantity > 0
                    ? 'shadow-lg shadow-brand/10 ring-brand'
                    : 'ring-transparent hover:shadow-md'
                } ${blocked ? 'opacity-60' : ''}`}
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
                    <span
                      className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        item.available ? 'bg-brand-soft text-brand' : 'bg-coral/10 text-coral'
                      }`}
                    >
                      {item.available ? d.available : d.unavailable}
                    </span>
                  </div>
                </div>
                <div className="mt-5 flex items-center justify-between gap-3">
                  {quantity === 0 ? (
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() => set(item.id, item.maxQuantity, 1)}
                      className="w-full rounded-full border-2 border-brand py-2.5 font-medium text-brand transition hover:bg-brand hover:text-white disabled:pointer-events-none"
                    >
                      + {d.add}
                    </button>
                  ) : (
                    <>
                      <span className="text-sm font-medium text-brand">✓ {d.added}</span>
                      <span className="flex items-center gap-2" dir="ltr">
                        <button
                          type="button"
                          aria-label={`${d.decrease} ${name}`}
                          onClick={() => set(item.id, item.maxQuantity, quantity - 1)}
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
                          aria-label={`${d.increase} ${name}`}
                          disabled={quantity >= item.maxQuantity}
                          onClick={() => set(item.id, item.maxQuantity, quantity + 1)}
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
      {waitlisted ? (
        <p className="mt-6 rounded-2xl bg-sun/30 px-4 py-3 text-sm text-ink" role="status">
          {d.waitlist}
        </p>
      ) : null}
      <div className="mt-8 flex flex-col items-center gap-3">
        <button
          type="button"
          disabled={chosen.length === 0}
          onClick={onNext}
          className={`${primaryButton} min-w-56 disabled:opacity-40 disabled:shadow-none`}
        >
          {d.next}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="px-4 py-2 font-medium text-muted underline underline-offset-4 hover:text-brand"
        >
          {d.skip}
        </button>
        <button type="button" onClick={onBack} className="text-sm text-muted hover:text-brand">
          {t.start.back}
        </button>
      </div>
    </div>
  );
}

function AccountStep({
  t,
  lang,
  business,
  session,
  account,
  setAccount,
  trialDays,
  devices,
  onBack,
  onStarted,
}: {
  t: Content;
  lang: Language;
  business: BusinessType;
  session: string;
  account: Account;
  setAccount: (update: (a: Account) => Account) => void;
  trialDays: number;
  devices: { itemId: string; quantity: number }[];
  onBack: () => void;
  onStarted: (started: TrialStarted) => void;
}) {
  const a = t.start.account;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<'taken' | 'unavailable' | 'rate' | 'other' | null>(null);
  const set = (field: keyof Account, value: string) =>
    setAccount((x) => ({ ...x, [field]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    const r = await post<TrialStarted>('start', {
      fullName: account.fullName,
      email: account.email,
      password: account.password,
      companyName: account.company,
      businessType: business,
      language: lang,
      sessionId: session,
      devices,
    });
    setSending(false);
    if (r.ok) return onStarted(r.data);
    if (r.code === 'EMAIL_ALREADY_REGISTERED') setError('taken');
    else if (r.issue === 'unavailable') setError('unavailable');
    else if (r.status === 429) setError('rate');
    else setError('other');
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="rounded-3xl bg-white p-6 shadow-sm sm:p-10">
      <h1 className="text-2xl font-bold sm:text-3xl">{a.title}</h1>
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-ink">{a.fullName}</span>
          <input
            required
            minLength={2}
            maxLength={120}
            autoComplete="name"
            value={account.fullName}
            onChange={(e) => set('fullName', e.target.value)}
            className={input}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">{a.email}</span>
          <input
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            dir="ltr"
            value={account.email}
            onChange={(e) => set('email', e.target.value)}
            className={`${input} text-start`}
          />
        </label>
        <div>
          <label className="block">
            <span className="text-sm font-medium text-ink">{a.password}</span>
            <input
              type="password"
              required
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
              dir="ltr"
              aria-describedby="password-hint"
              value={account.password}
              onChange={(e) => set('password', e.target.value)}
              className={`${input} text-start`}
            />
          </label>
          <span id="password-hint" className="mt-1 block text-xs text-muted">
            {a.passwordHint}
          </span>
        </div>
        <label className="block">
          <span className="text-sm font-medium text-ink">{a.company}</span>
          <input
            maxLength={120}
            autoComplete="organization"
            value={account.company}
            onChange={(e) => set('company', e.target.value)}
            className={input}
          />
        </label>
      </div>
      <p className="mt-6 flex items-start gap-2 rounded-2xl bg-brand-soft px-4 py-3 text-sm text-brand">
        <span aria-hidden="true">🎁</span>
        {fill(a.trial, { length: t.trialLength(trialDays) })}
      </p>
      {error ? (
        <p role="alert" className="mt-4 rounded-2xl bg-coral/10 px-4 py-3 text-sm text-coral">
          {error === 'taken' ? (
            <>
              {a.emailTaken}{' '}
              <a href={SIGN_IN_URL} className="font-bold underline">
                {a.signIn}
              </a>
            </>
          ) : error === 'unavailable' ? (
            a.unavailable
          ) : error === 'rate' ? (
            a.rateLimited
          ) : (
            a.error
          )}
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="px-2 py-2 text-muted hover:text-brand">
          {t.start.back}
        </button>
        <button type="submit" disabled={sending} className={`${primaryButton} disabled:opacity-60`}>
          {sending ? a.sending : a.submit}
        </button>
      </div>
    </form>
  );
}

function Summary({
  t,
  lang,
  offer,
  quantities,
  trialDays,
}: {
  t: Content;
  lang: Language;
  offer: PublicTrialOffer;
  quantities: Quantities;
  trialDays: number;
}) {
  const m = t.start.summary;
  const chosen = offer.devices.filter((d) => (quantities[d.id] ?? 0) > 0);
  const system = Money.parse(offer.systemPrice.amount, CURRENCY);
  let devices = Money.zero(CURRENCY);
  let count = 0;
  for (const d of chosen) {
    const quantity = quantities[d.id] ?? 0;
    devices = devices.add(Money.parse(d.price.amount, CURRENCY).multiply(String(quantity)));
    count += quantity;
  }
  const total = system.add(devices).toDecimalString();
  return (
    <aside className="hidden lg:block">
      <div className="sticky top-24 rounded-3xl bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold">{m.title}</h3>
        <ul className="mt-4 space-y-3 text-sm">
          <li className="flex items-start justify-between gap-3">
            <span className="text-ink">
              {lang === 'ar' ? offer.systemNameAr : offer.systemNameEn}
            </span>
            <span className="tabular-nums" dir="ltr">
              {system.toDecimalString()}
            </span>
          </li>
          {chosen.map((d) => (
            <li key={d.id} className="cart-line flex items-start justify-between gap-3">
              <span className="text-ink">
                {lang === 'ar' ? d.nameAr : d.nameEn}{' '}
                <span className="text-muted">× {quantities[d.id]}</span>
              </span>
              <span className="tabular-nums" dir="ltr">
                {Money.parse(d.price.amount, CURRENCY)
                  .multiply(String(quantities[d.id]))
                  .toDecimalString()}
              </span>
            </li>
          ))}
          {chosen.length === 0 ? <li className="text-muted">{m.own}</li> : null}
        </ul>
        <dl className="mt-5 space-y-2 border-t border-black/5 pt-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{m.system}</dt>
            <dd className="tabular-nums" dir="ltr">
              {system.toDecimalString()}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">
              {m.devices}
              {count ? ` · ${fill(m.items, { n: count })}` : ''}
            </dt>
            <dd className="tabular-nums" dir="ltr">
              {devices.toDecimalString()}
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex items-start justify-between gap-3 rounded-2xl bg-brand-soft px-4 py-3 text-sm">
          <div>
            <p className="font-medium text-brand">{m.trial}</p>
            {chosen.length ? <p className="mt-0.5 text-xs text-muted">{m.fromDelivery}</p> : null}
          </div>
          <p key={trialDays} className="bump font-bold text-brand">
            {t.trialLength(trialDays)}
          </p>
        </div>
        <div className="mt-3 rounded-2xl bg-brand p-4 text-white">
          <p className="text-sm text-white/85">{m.firstPayment}</p>
          <p key={total} className="bump text-3xl font-bold tabular-nums" dir="ltr">
            {total} <span className="text-base">{t.pricing.currency}</span>
          </p>
          <p className="mt-1 text-xs text-white/80">
            {fill(m.renewal, { amount: system.toDecimalString() })}
          </p>
        </div>
      </div>
    </aside>
  );
}

function Done({ t, result }: { t: Content; result: TrialStarted }) {
  const d = t.start.done;
  return (
    <div className="step-in mx-auto max-w-2xl rounded-3xl bg-white p-8 text-center shadow-sm sm:p-12">
      <span className="pop mx-auto grid size-20 place-items-center rounded-full bg-brand text-4xl text-white shadow-lg shadow-brand/30">
        ✓
      </span>
      <h1 className="mt-6 text-3xl font-bold">
        {fill(d.title, { length: t.trialLength(result.trialDays) })}
      </h1>
      {result.devices !== 'none' ? (
        <p className="mt-3 text-lg leading-relaxed text-muted">
          {result.devices === 'waitlist' ? d.waitlist : d.devices}
        </p>
      ) : null}
      <a href={result.redirectTo} className={`${primaryButton} mt-8`}>
        {d.enter}
      </a>
      <p className="mt-6 text-sm text-muted">
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand" dir="ltr">
          {CONTACT_EMAIL}
        </a>
      </p>
    </div>
  );
}
