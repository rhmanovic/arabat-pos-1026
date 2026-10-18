import {
  type BusinessType,
  type PublicTrialOffer,
  type TrialStarted,
  type TrialVerified,
  BUSINESS_TYPES,
  DEMO_CATALOGS,
  type FunnelStep,
} from '@arabat/contracts';
import { Money } from '@arabat/money';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { CONTACT_EMAIL, type Content, type Language } from './content.js';
import { ItemIllustration } from './illustrations.js';
import { Footer, Header, SIGN_IN_URL, primaryButton, useLanguage } from './layout.js';

const CURRENCY = 'KWD' as const;
type Step = 'business' | 'demo' | 'devices' | 'account' | 'verify' | 'done';
const PROGRESS: Step[] = ['business', 'demo', 'devices', 'account'];
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

/** The free-trial funnel (ADR-0115): business → demo till → shop set-up → account → code. */
export function StartPage() {
  const { lang, t, toggleLanguage } = useLanguage((c) => c.start.pageTitle);
  const s = t.start;
  const [session] = useState(sessionId);
  const [offer, setOffer] = useState<PublicTrialOffer | null>(null);
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState<Step>('business');
  const [business, setBusiness] = useState<BusinessType>('retail');
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState<'own' | 'want' | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [signup, setSignup] = useState<TrialStarted | null>(null);
  const [result, setResult] = useState<TrialVerified | null>(null);
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
    if (next === 'demo') track('demo');
    if (next === 'devices') track('devices');
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const chosen = offer
    ? offer.devices.filter((d) => mode === 'want' && (quantities[d.id] ?? 0) > 0)
    : [];
  const trialDays = !offer ? 0 : chosen.length ? offer.trialDaysDevices : offer.trialDaysOwn;

  return (
    <div className="flex min-h-screen flex-col bg-sand">
      <Header t={t} onToggleLanguage={toggleLanguage} page="start" />
      <main className="flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <div ref={top} className="mx-auto max-w-3xl scroll-mt-24">
          {PROGRESS.includes(step) ? <Progress t={t} step={step} /> : null}
          {!offer ? (
            <p className="py-20 text-center text-lg text-muted" role={failed ? 'alert' : 'status'}>
              {failed ? s.loadError : s.loading}
            </p>
          ) : (
            <div key={step} className="step-in mt-8">
              {step === 'business' ? (
                <BusinessStep
                  t={t}
                  onPick={(type) => {
                    setBusiness(type);
                    track('business');
                    go('demo');
                  }}
                />
              ) : null}
              {step === 'demo' ? (
                <DemoStep
                  t={t}
                  lang={lang}
                  business={business}
                  session={session}
                  email={email}
                  setEmail={setEmail}
                  onBack={() => go('business')}
                  onNext={() => go('devices')}
                />
              ) : null}
              {step === 'devices' ? (
                <DevicesStep
                  t={t}
                  lang={lang}
                  offer={offer}
                  mode={mode}
                  setMode={setMode}
                  quantities={quantities}
                  setQuantities={setQuantities}
                  onBack={() => go('demo')}
                  onNext={() => go('account')}
                />
              ) : null}
              {step === 'account' ? (
                <AccountStep
                  t={t}
                  lang={lang}
                  business={business}
                  session={session}
                  email={email}
                  setEmail={setEmail}
                  trialDays={trialDays}
                  devices={chosen.map((d) => ({ itemId: d.id, quantity: quantities[d.id]! }))}
                  onBack={() => go('devices')}
                  onStarted={(started) => {
                    setSignup(started);
                    go('verify');
                  }}
                />
              ) : null}
              {step === 'verify' && signup ? (
                <VerifyStep
                  t={t}
                  signup={signup}
                  onVerified={(verified) => {
                    setResult(verified);
                    go('done');
                  }}
                />
              ) : null}
              {step === 'done' && result ? <DoneStep t={t} result={result} /> : null}
            </div>
          )}
        </div>
      </main>
      <Footer t={t} page="start" />
    </div>
  );
}

function Progress({ t, step }: { t: Content; step: Step }) {
  const index = PROGRESS.indexOf(step);
  return (
    <div>
      <div className="flex justify-between text-xs text-muted sm:text-sm">
        {t.start.progress.map((label, i) => (
          <span key={label} className={i <= index ? 'font-bold text-brand' : ''}>
            {label}
          </span>
        ))}
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
        <div
          className="h-full rounded-full bg-brand transition-all duration-500"
          style={{ width: `${((index + 1) / PROGRESS.length) * 100}%` }}
        />
      </div>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-3xl bg-white p-6 shadow-sm sm:p-10">{children}</div>;
}

function BusinessStep({ t, onPick }: { t: Content; onPick: (type: BusinessType) => void }) {
  const b = t.start.business;
  return (
    <Card>
      <h1 className="text-2xl font-bold sm:text-3xl">{b.title}</h1>
      <p className="mt-2 text-muted">{b.text}</p>
      <div className="mt-8 grid grid-cols-2 gap-4">
        {BUSINESS_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onPick(type)}
            className="flex flex-col items-center gap-3 rounded-2xl border-2 border-black/5 bg-sand p-6 text-lg font-bold text-ink transition hover:-translate-y-0.5 hover:border-brand hover:bg-brand-soft"
          >
            <span className="text-4xl" aria-hidden="true">
              {BUSINESS_ICON[type]}
            </span>
            {b.types[type]}
          </button>
        ))}
      </div>
    </Card>
  );
}

function DemoStep({
  t,
  lang,
  business,
  session,
  email,
  setEmail,
  onBack,
  onNext,
}: {
  t: Content;
  lang: Language;
  business: BusinessType;
  session: string;
  email: string;
  setEmail: (email: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const d = t.start.demo;
  const products = DEMO_CATALOGS[business];
  const [cart, setCart] = useState<Record<string, number>>({});
  const [paid, setPaid] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const lines = products
    .filter((p) => (cart[p.key] ?? 0) > 0)
    .map((p) => ({
      product: p,
      quantity: cart[p.key]!,
      total: Money.parse(p.price, CURRENCY).multiply(String(cart[p.key])),
    }));
  const total = lines.reduce((sum, l) => sum.add(l.total), Money.zero(CURRENCY));
  const name = (p: (typeof products)[number]) => (lang === 'ar' ? p.nameAr : p.nameEn);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(false);
    const r = await post('demo-receipt', {
      email,
      businessType: business,
      language: lang,
      sessionId: session,
      lines: lines.map((l) => ({ key: l.product.key, quantity: l.quantity })),
    });
    setSending(false);
    if (r.ok) setSent(email);
    else setError(true);
  };

  return (
    <Card>
      <h1 className="text-2xl font-bold sm:text-3xl">{d.title}</h1>
      <p className="mt-2 text-muted">{d.text}</p>
      {!paid ? (
        <div className="mt-8 grid gap-6 md:grid-cols-5">
          <ul className="grid grid-cols-2 gap-3 md:col-span-3">
            {products.map((p) => (
              <li key={p.key}>
                <button
                  type="button"
                  onClick={() =>
                    setCart((c) => ({ ...c, [p.key]: Math.min(99, (c[p.key] ?? 0) + 1) }))
                  }
                  className="flex h-full w-full flex-col items-start rounded-2xl bg-sand p-4 text-start transition hover:bg-brand-soft active:scale-95"
                >
                  <span className="font-bold text-ink">{name(p)}</span>
                  <span className="mt-1 text-sm tabular-nums text-muted" dir="ltr">
                    {p.price} {t.pricing.currency}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-col rounded-2xl border border-black/5 p-4 md:col-span-2">
            <p className="font-bold">{d.cart}</p>
            {lines.length === 0 ? (
              <p className="mt-4 flex-1 text-sm text-muted">{d.empty}</p>
            ) : (
              <ul className="mt-3 flex-1 space-y-2 text-sm">
                {lines.map((l) => (
                  <li
                    key={l.product.key}
                    className="cart-line flex items-center justify-between gap-2"
                  >
                    <span>
                      {name(l.product)} <span className="text-muted">× {l.quantity}</span>
                    </span>
                    <span className="tabular-nums" dir="ltr">
                      {l.total.toDecimalString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-3">
              <span className="text-muted">{d.total}</span>
              <span
                key={total.toDecimalString()}
                className="bump text-xl font-bold tabular-nums"
                dir="ltr"
              >
                {total.toDecimalString()}{' '}
                <span className="text-sm text-muted">{t.pricing.currency}</span>
              </span>
            </div>
            <button
              type="button"
              disabled={lines.length === 0}
              onClick={() => setPaid(true)}
              className="mt-4 rounded-full bg-brand py-3 font-medium text-white transition hover:bg-brand-dark disabled:opacity-40"
            >
              {d.pay}
            </button>
            {lines.length ? (
              <button type="button" onClick={() => setCart({})} className="mt-2 text-sm text-muted">
                {d.clear}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-8">
          <div className="mx-auto max-w-sm rounded-2xl border border-dashed border-black/15 bg-sand p-5">
            <p className="text-center font-bold text-brand">✓ {d.paid}</p>
            <p className="mt-3 text-center text-sm text-muted">{d.receiptTitle}</p>
            <ul className="mt-3 space-y-1 text-sm">
              {lines.map((l) => (
                <li key={l.product.key} className="flex justify-between gap-2">
                  <span>
                    {name(l.product)} × {l.quantity}
                  </span>
                  <span className="tabular-nums" dir="ltr">
                    {l.total.toDecimalString()}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex justify-between border-t border-black/10 pt-2 font-bold">
              <span>{d.total}</span>
              <span className="tabular-nums" dir="ltr">
                {total.toDecimalString()} {t.pricing.currency}
              </span>
            </p>
          </div>
          {sent ? (
            <p
              className="mt-6 rounded-2xl bg-brand-soft px-4 py-3 text-center text-brand"
              role="status"
            >
              {fill(d.sent, { email: sent })}
            </p>
          ) : (
            <form onSubmit={(e) => void send(e)} className="mx-auto mt-6 max-w-sm">
              <label className="block">
                <span className="text-sm font-medium text-ink">{d.emailAsk}</span>
                <span className="mt-1.5 flex gap-2">
                  <input
                    type="email"
                    required
                    dir="ltr"
                    autoComplete="email"
                    placeholder={d.emailPlaceholder}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={`${input} mt-0 text-start`}
                  />
                  <button
                    type="submit"
                    disabled={sending}
                    className="shrink-0 rounded-xl bg-brand px-5 font-medium text-white disabled:opacity-60"
                  >
                    {sending ? d.sending : d.send}
                  </button>
                </span>
              </label>
              {error ? (
                <p role="alert" className="mt-2 text-sm text-coral">
                  {d.sendError}
                </p>
              ) : null}
            </form>
          )}
          <p className="mt-4 text-center">
            <button
              type="button"
              onClick={() => {
                setCart({});
                setPaid(false);
                setSent(null);
              }}
              className="text-sm text-muted underline"
            >
              {d.again}
            </button>
          </p>
        </div>
      )}
      {!paid && lines.length ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-black/5 bg-white/95 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] backdrop-blur md:hidden">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
            <p className="text-xl font-bold tabular-nums text-ink" dir="ltr">
              {total.toDecimalString()}{' '}
              <span className="text-sm text-muted">{t.pricing.currency}</span>
            </p>
            <button
              type="button"
              onClick={() => setPaid(true)}
              className="rounded-full bg-brand px-8 py-2.5 font-medium text-white"
            >
              {d.pay}
            </button>
          </div>
        </div>
      ) : null}
      <div className="mt-8 flex items-center justify-between gap-3 border-t border-black/5 pt-6">
        <button type="button" onClick={onBack} className="px-2 py-2 text-muted hover:text-brand">
          {t.start.back}
        </button>
        <button
          type="button"
          onClick={onNext}
          className={paid ? primaryButton : 'px-4 py-2 font-medium text-brand'}
        >
          {paid ? d.next : d.skip}
        </button>
      </div>
    </Card>
  );
}

function DevicesStep({
  t,
  lang,
  offer,
  mode,
  setMode,
  quantities,
  setQuantities,
  onBack,
  onNext,
}: {
  t: Content;
  lang: Language;
  offer: PublicTrialOffer;
  mode: 'own' | 'want' | null;
  setMode: (mode: 'own' | 'want') => void;
  quantities: Record<string, number>;
  setQuantities: (update: (q: Record<string, number>) => Record<string, number>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const d = t.start.devices;
  const [warn, setWarn] = useState(false);
  const chosen = offer.devices.filter((x) => (quantities[x.id] ?? 0) > 0);
  const waitlisted = mode === 'want' && chosen.some((x) => !x.available);
  const set = (id: string, max: number, quantity: number) =>
    setQuantities((q) => ({ ...q, [id]: Math.max(0, Math.min(max, quantity)) }));
  const option = (value: 'own' | 'want', title: string, text: string, icon: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(value);
        setWarn(false);
      }}
      aria-pressed={mode === value}
      className={`flex items-start gap-4 rounded-2xl border-2 p-5 text-start transition ${
        mode === value
          ? 'border-brand bg-brand-soft'
          : 'border-black/5 bg-sand hover:border-brand/40'
      }`}
    >
      <span className="text-3xl" aria-hidden="true">
        {icon}
      </span>
      <span>
        <span className="block text-lg font-bold text-ink">{title}</span>
        <span className="mt-1 block text-sm text-muted">{text}</span>
      </span>
    </button>
  );
  return (
    <Card>
      <h1 className="text-2xl font-bold sm:text-3xl">{d.title}</h1>
      <p className="mt-2 text-muted">{d.text}</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {option('own', d.own, d.ownText, '📱')}
        {option('want', d.want, d.wantText, '🖨️')}
      </div>
      {mode === 'want' ? (
        offer.devices.length === 0 ? (
          <p className="mt-6 rounded-2xl bg-sand p-5 text-center text-muted">{d.none}</p>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {offer.devices.map((item) => {
              const quantity = quantities[item.id] ?? 0;
              const name = lang === 'ar' ? item.nameAr : item.nameEn;
              const blocked = !item.available && !offer.waitlistEnabled;
              return (
                <li
                  key={item.id}
                  className={`flex flex-col rounded-2xl p-4 ring-2 transition ${
                    quantity > 0 ? 'bg-white ring-brand' : 'bg-sand ring-transparent'
                  } ${blocked ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        loading="lazy"
                        className="size-16 shrink-0 rounded-xl object-cover"
                      />
                    ) : (
                      <ItemIllustration icon={item.icon} className="size-16 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="font-bold text-ink">{name}</p>
                      <span
                        className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          item.available ? 'bg-brand-soft text-brand' : 'bg-coral/10 text-coral'
                        }`}
                      >
                        {item.available ? d.available : d.unavailable}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4">
                    {quantity === 0 ? (
                      <button
                        type="button"
                        disabled={blocked}
                        onClick={() => set(item.id, item.maxQuantity, 1)}
                        className="w-full rounded-full border-2 border-brand py-2 font-medium text-brand transition hover:bg-brand hover:text-white disabled:pointer-events-none"
                      >
                        + {d.add}
                      </button>
                    ) : (
                      <span className="flex items-center justify-center gap-3" dir="ltr">
                        <button
                          type="button"
                          aria-label={`${d.decrease} ${name}`}
                          onClick={() => set(item.id, item.maxQuantity, quantity - 1)}
                          className="grid size-10 place-items-center rounded-full bg-sand text-xl font-bold"
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
                          className="grid size-10 place-items-center rounded-full bg-brand text-xl font-bold text-white disabled:opacity-40"
                        >
                          +
                        </button>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
      {waitlisted ? (
        <p className="mt-6 rounded-2xl bg-sun/30 px-4 py-3 text-sm text-ink" role="status">
          {d.waitlist}
        </p>
      ) : null}
      {warn ? (
        <p className="mt-4 text-sm text-coral" role="alert">
          {d.pickOne}
        </p>
      ) : null}
      <div className="mt-8 flex items-center justify-between gap-3 border-t border-black/5 pt-6">
        <button type="button" onClick={onBack} className="px-2 py-2 text-muted hover:text-brand">
          {t.start.back}
        </button>
        <button
          type="button"
          disabled={mode === null}
          onClick={() => {
            if (mode === 'want' && chosen.length === 0 && offer.devices.length > 0) setWarn(true);
            else onNext();
          }}
          className={`${primaryButton} disabled:opacity-40`}
        >
          {d.next}
        </button>
      </div>
    </Card>
  );
}

function AccountStep({
  t,
  lang,
  business,
  session,
  email,
  setEmail,
  trialDays,
  devices,
  onBack,
  onStarted,
}: {
  t: Content;
  lang: Language;
  business: BusinessType;
  session: string;
  email: string;
  setEmail: (email: string) => void;
  trialDays: number;
  devices: { itemId: string; quantity: number }[];
  onBack: () => void;
  onStarted: (started: TrialStarted) => void;
}) {
  const a = t.start.account;
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [company, setCompany] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<'taken' | 'unavailable' | 'rate' | 'other' | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    const r = await post<TrialStarted>('start', {
      fullName,
      email,
      password,
      companyName: company,
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
    <Card>
      <form onSubmit={(e) => void submit(e)}>
        <h1 className="text-2xl font-bold sm:text-3xl">{a.title}</h1>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-ink">{a.fullName}</span>
            <input
              required
              minLength={2}
              maxLength={120}
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className={input}
            />
          </label>
        </div>
        <p className="mt-6 rounded-2xl bg-brand-soft px-4 py-3 text-sm text-brand">
          🎁 {fill(a.trial, { days: trialDays })}
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
        <div className="mt-8 flex items-center justify-between gap-3 border-t border-black/5 pt-6">
          <button type="button" onClick={onBack} className="px-2 py-2 text-muted hover:text-brand">
            {t.start.back}
          </button>
          <button
            type="submit"
            disabled={sending}
            className={`${primaryButton} disabled:opacity-60`}
          >
            {sending ? a.sending : a.submit}
          </button>
        </div>
      </form>
    </Card>
  );
}

const RESEND_SECONDS = 30;

function VerifyStep({
  t,
  signup,
  onVerified,
}: {
  t: Content;
  signup: TrialStarted;
  onVerified: (verified: TrialVerified) => void;
}) {
  const v = t.start.verify;
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);
  const [wait, setWait] = useState(RESEND_SECONDS);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setChecking(true);
    setMessage(null);
    const r = await post<TrialVerified>('verify', { signupId: signup.signupId, code });
    setChecking(false);
    if (r.ok) return onVerified(r.data);
    setMessage({ tone: 'error', text: r.code === 'INVALID_CODE' ? v.invalid : v.error });
  };
  const resend = async () => {
    setMessage(null);
    const r = await post('resend', { signupId: signup.signupId });
    if (r.ok) {
      setWait(RESEND_SECONDS);
      setMessage({ tone: 'ok', text: v.resent });
    } else setMessage({ tone: 'error', text: r.code === 'CODE_LIMIT' ? v.limit : v.error });
  };
  return (
    <Card>
      <form onSubmit={(e) => void submit(e)} className="text-center">
        <span
          className="mx-auto grid size-16 place-items-center rounded-full bg-brand-soft text-3xl"
          aria-hidden="true"
        >
          ✉️
        </span>
        <h1 className="mt-4 text-2xl font-bold sm:text-3xl">{v.title}</h1>
        <p className="mt-2 text-muted">
          {v.text.split('{email}')[0]}
          <span dir="ltr" className="font-bold text-ink">
            {signup.email}
          </span>
          {v.text.split('{email}')[1]}
        </p>
        <label className="mx-auto mt-8 block max-w-xs">
          <span className="sr-only">{v.code}</span>
          <input
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            dir="ltr"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className={`${input} text-center text-3xl tracking-[0.5em]`}
            aria-label={v.code}
          />
        </label>
        {message ? (
          <p
            role={message.tone === 'error' ? 'alert' : 'status'}
            className={`mt-4 text-sm ${message.tone === 'error' ? 'text-coral' : 'text-brand'}`}
          >
            {message.text}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={checking || code.length !== 6}
          className={`${primaryButton} mt-6 disabled:opacity-50`}
        >
          {checking ? v.checking : v.submit}
        </button>
        <p className="mt-6 text-sm">
          {wait > 0 ? (
            <span className="text-muted">{fill(v.wait, { seconds: wait })}</span>
          ) : (
            <button type="button" onClick={() => void resend()} className="text-brand underline">
              {v.resend}
            </button>
          )}
        </p>
      </form>
    </Card>
  );
}

function DoneStep({ t, result }: { t: Content; result: TrialVerified }) {
  const d = t.start.done;
  return (
    <Card>
      <div className="text-center">
        <span className="pop mx-auto grid size-20 place-items-center rounded-full bg-brand text-4xl text-white shadow-lg shadow-brand/30">
          ✓
        </span>
        <h1 className="mt-6 text-2xl font-bold sm:text-3xl">
          {fill(d.title, { days: result.trialDays })}
        </h1>
        {result.devices !== 'none' ? (
          <p className="mx-auto mt-4 max-w-lg leading-relaxed text-muted">
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
    </Card>
  );
}
