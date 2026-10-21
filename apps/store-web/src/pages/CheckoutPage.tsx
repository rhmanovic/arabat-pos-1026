import { ApiError } from '@arabat/api-client';
import { formatDateTime } from '@arabat/i18n';
import { Alert, Button, Checkbox, Field, Input, Select, Spinner, Textarea, cn } from '@arabat/ui';
import { useApi, useErrorMessage } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router';
import { priceLines, sampleLines, toMoney, useCart } from '../cart.js';
import { isPreview, linkTarget, useDesign, useText } from '../design/context.js';
import { StoreIcon } from '../design/parts.js';
import { Highlights } from '../design/product-parts.js';
import {
  useAccount,
  useBranchChoice,
  useLocalName,
  useMoney,
  useSlug,
  useStoreProducts,
  useStorefront,
} from '../shared.js';

const newKey = () => globalThis.crypto.randomUUID();

/**
 * Checkout: the server re-prices the cart and either reserves the stock and starts the
 * payment (the shopper is then sent to the gateway's page) or, when paying on receipt, places
 * the order for the store to confirm. The idempotency key is kept across retries of the same
 * submission (network errors) and renewed when the server refused it.
 */
const ON_RECEIPT = 'on_receipt';

/** A pickup / delivery or payment choice: a large card or a plain line (the design decides). */
function Choice({ cards, children }: { cards: boolean; children: ReactNode }) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2',
        cards &&
          'min-h-12 rounded-lg border border-border bg-surface px-4 py-3 font-medium transition-colors hover:border-border-strong has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:ring-1 has-[:checked]:ring-primary',
      )}
    >
      {children}
    </label>
  );
}

/** A part of the form, numbered when the design shows steps. */
function Step({ n, steps, children }: { n: number; steps: boolean; children: ReactNode }) {
  return (
    <legend className="mb-2 flex items-center gap-2 font-semibold">
      {steps ? (
        <span
          aria-hidden
          className="grid size-7 place-items-center rounded-full bg-primary text-sm text-primary-fg"
        >
          {n}
        </span>
      ) : null}
      {children}
    </legend>
  );
}

/** The checkout, drawn by the store design's checkout page (ADR-0128 amendment 5). */
export function CheckoutPage() {
  const api = useApi();
  const slug = useSlug();
  const cart = useCart();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: store } = useStorefront();
  const products = useStoreProducts();
  const name = useLocalName();
  const money = useMoney();
  const errorMessage = useErrorMessage();
  const { t } = useTranslation();
  const page = useDesign().checkoutPage;
  const text = useText();
  const preview = isPreview();
  const [key, setKey] = useState(newKey);
  const [form, setForm] = useState({
    /** Null = not typed yet: a signed-in shopper's account value shows instead (ADR-0124). */
    name: null as string | null,
    phone: null as string | null,
    email: null as string | null,
    fulfillment: null as 'pickup' | 'delivery' | null,
    deliveryAddress: null as string | null,
    /** Delivery area (ADR-0123); required when the store defines areas. */
    areaId: null as string | null,
    /** Requested slot start, or null for "as soon as possible". */
    scheduledFor: null as string | null,
    note: '',
    /** A gateway method id, `ON_RECEIPT`, or null until chosen. */
    payment: null as string | null,
    /** Promotion code typed by the shopper (ADR-0125); applied through the quote. */
    promoInput: '',
    promotionCode: null as string | null,
    /** A saved address of the account (ADR-0124): null = untouched (the default one), '' = a new one. */
    savedAddressId: null as string | null,
    saveAddress: false,
    terms: false,
  });
  const [touched, setTouched] = useState(false);
  const { branch: pickupBranch, setBranchId } = useBranchChoice();
  const { token, account, addresses } = useAccount();
  // A signed-in shopper's details and default address show until they type something else.
  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
  const savedAddressId = form.savedAddressId ?? defaultAddress?.id ?? '';
  const savedAddress = addresses.find((a) => a.id === savedAddressId) ?? null;
  const values = {
    name: form.name ?? account?.fullName ?? '',
    phone: form.phone ?? account?.phone ?? '',
    email: form.email ?? account?.email ?? '',
    deliveryAddress: form.deliveryAddress ?? savedAddress?.address ?? '',
    areaId: form.areaId ?? savedAddress?.deliveryAreaId ?? null,
  };

  const checkout = useMutation({
    mutationFn: (body: Parameters<typeof api.store.checkout>[1]) =>
      api.store.checkout(slug, body, token),
    onSuccess: ({ order }) => {
      // Leave the page before emptying the cart, or the empty cart would send us to the cart page.
      if (order.paymentUrl) window.location.assign(order.paymentUrl);
      else void navigate(`/${slug}/orders/${order.trackingToken}`, { replace: true });
      cart.clear();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status < 500) {
        setKey(newKey());
        void queryClient.invalidateQueries({ queryKey: ['store', slug, 'products'] });
      }
    },
  });

  const fulfillment = form.fulfillment ?? ((store?.pickupEnabled ?? true) ? 'pickup' : 'delivery');
  const deliveryAreas = store?.deliveryAreas ?? [];
  const area =
    fulfillment === 'delivery' ? (deliveryAreas.find((a) => a.id === values.areaId) ?? null) : null;
  // Inside the console's preview an empty cart shows two sample products (never ordered).
  const sample =
    preview && cart.lines.length === 0 && products.data
      ? sampleLines(products.data.products)
      : null;
  const { priced, subtotal, deliveryFee, total } = priceLines(
    sample ?? cart.lines,
    products.data?.products ?? [],
    store ?? { deliveryFee: { amount: '0.000', currency: 'KWD' } },
    fulfillment,
    deliveryAreas.length > 0 ? area : undefined,
  );
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  // The server's totals with the promotion that applies (ADR-0125).
  const quote = useQuery({
    queryKey: [
      'store',
      slug,
      'quote',
      priced.map((l) => `${l.variantId}:${l.quantity}`).join(','),
      fulfillment,
      area?.id ?? null,
      pickupBranch?.id ?? null,
      form.promotionCode,
      token,
    ],
    enabled: priced.length > 0,
    staleTime: 30_000,
    queryFn: () =>
      api.store.quote(
        slug,
        {
          lines: priced.map((l) => ({ variantId: l.variantId, quantity: String(l.quantity) })),
          fulfillment,
          deliveryAreaId: area?.id ?? null,
          branchId: fulfillment === 'pickup' ? (pickupBranch?.id ?? null) : null,
          promotionCode: form.promotionCode,
        },
        token,
      ),
  });
  const quoted = quote.data ?? null;
  const shownDeliveryFee = quoted ? toMoney(quoted.deliveryFee) : deliveryFee;
  const shownDiscount = quoted ? toMoney(quoted.discount) : null;
  const shownTotal = quoted ? toMoney(quoted.total) : total;

  if (!store || products.isPending) return <Spinner label={t('common:status.loading')} />;
  if (!products.data || (cart.lines.length === 0 && !checkout.isSuccess && !sample))
    return <Navigate to={`/${slug}/cart`} replace />;

  const payment =
    form.payment ?? store.paymentMethods[0]?.id ?? (store.payOnReceipt ? ON_RECEIPT : null);
  const payOnReceipt = payment === ON_RECEIPT;
  const missing = {
    name: !values.name.trim(),
    phone: values.phone.trim().length < 6,
    email: page.email === 'required' && !/^\S+@\S+\.\S+$/.test(values.email.trim()),
    terms: page.terms.enabled && !form.terms,
    address: fulfillment === 'delivery' && !values.deliveryAddress.trim(),
    area: fulfillment === 'delivery' && store.deliveryAreas.length > 0 && area === null,
  };
  // The branch that prepares the order: the pickup branch, or the one serving the area.
  const branch =
    fulfillment === 'delivery'
      ? (store.branches.find((b) => b.id === area?.branchId) ?? pickupBranch)
      : pickupBranch;
  const pickupBranches = store.branches.filter((b) => b.pickupEnabled);
  const closedNow = branch !== null && !branch.openNow;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (missing.name || missing.phone || missing.address || !payment) return;
    if (missing.area || missing.email || missing.terms) return;
    // The preview shows the page only: nothing is ordered from it.
    if (preview) return;
    checkout.mutate({
      idempotencyKey: key,
      lines: priced.map((l) => ({ variantId: l.variantId, quantity: String(l.quantity) })),
      fulfillment,
      customer: {
        name: values.name,
        phone: values.phone,
        email: page.email === 'hidden' ? null : values.email || null,
      },
      deliveryAddress: fulfillment === 'delivery' ? values.deliveryAddress : null,
      branchId: fulfillment === 'pickup' ? (pickupBranch?.id ?? null) : null,
      deliveryAreaId: area?.id ?? null,
      scheduledFor: form.scheduledFor,
      note: page.note.enabled ? form.note || null : null,
      promotionCode: quoted?.promotion?.code ?? null,
      saveAddress: Boolean(token) && form.saveAddress && savedAddressId === '',
      paymentMethodId: payOnReceipt ? null : payment,
      expectedTotal: shownTotal.toDecimalString(),
    });
  };
  const required = (bad: boolean) => (touched && bad ? t('checkout.required') : undefined);
  const cards = page.choices === 'cards';
  const showWhen = store.scheduling.enabled || closedNow;
  const termsLink = linkTarget(slug, page.terms.link);
  const submitLabel =
    text(page.submitLabel) || (payOnReceipt ? t('checkout.submitOnReceipt') : t('checkout.submit'));

  return (
    <form
      onSubmit={submit}
      className={cn(
        'grid grid-cols-[minmax(0,1fr)] gap-6',
        page.layout === 'split' ? 'md:grid-cols-[minmax(0,1fr)_20rem]' : 'mx-auto w-full max-w-2xl',
      )}
      data-testid="checkout-page"
      data-layout={page.layout}
      noValidate
    >
      <div className="flex min-w-0 flex-col gap-6">
        <h1 className="text-2xl font-semibold">{t('checkout.title')}</h1>
        {preview ? <Alert tone="info">{t('checkout.previewOnly')}</Alert> : null}
        {text(page.message) ? (
          <p
            className="rounded-lg bg-primary-soft px-4 py-3 text-sm"
            data-testid="checkout-message"
          >
            {text(page.message)}
          </p>
        ) : null}
        <fieldset className="flex flex-col gap-3">
          <Step n={1} steps={page.steps}>
            {t('checkout.contact')}
          </Step>
          {store.accountsEnabled && !token ? (
            <p className="text-sm text-fg-muted">
              <Link to={`/${slug}/account`} className="text-primary hover:underline">
                {t('nav.signIn')}
              </Link>{' '}
              {t('account.signInHint')}
            </p>
          ) : null}
          <Field label={t('checkout.name')} error={required(missing.name)}>
            {(p) => (
              <Input
                {...p}
                autoComplete="name"
                value={values.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('checkout.phone')} error={required(missing.phone)}>
            {(p) => (
              <Input
                {...p}
                type="tel"
                autoComplete="tel"
                dir="ltr"
                value={values.phone}
                onChange={(e) => set({ phone: e.target.value })}
              />
            )}
          </Field>
          {page.email !== 'hidden' ? (
            <Field
              label={page.email === 'required' ? t('checkout.emailRequired') : t('checkout.email')}
              error={required(missing.email)}
            >
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  autoComplete="email"
                  dir="ltr"
                  value={values.email}
                  onChange={(e) => set({ email: e.target.value })}
                />
              )}
            </Field>
          ) : null}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <Step n={2} steps={page.steps}>
            {t('checkout.fulfillment')}
          </Step>
          {store.pickupEnabled ? (
            <Choice cards={cards}>
              <input
                type="radio"
                name="fulfillment"
                className="accent-primary"
                checked={fulfillment === 'pickup'}
                onChange={() => set({ fulfillment: 'pickup', scheduledFor: null })}
              />
              {cards ? <StoreIcon name="store" className="size-5 text-fg-muted" /> : null}
              {t('checkout.pickup')}
            </Choice>
          ) : null}
          {fulfillment === 'pickup' && pickupBranches.length > 1 ? (
            <Field label={t('checkout.branch')}>
              {(p) => (
                <Select
                  {...p}
                  value={pickupBranch?.id ?? ''}
                  onChange={(e) => setBranchId(e.target.value || null)}
                >
                  {pickupBranches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {[name(b), b.address].filter(Boolean).join(' — ')}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : fulfillment === 'pickup' && branch?.address ? (
            <p className="text-sm text-fg-muted">{[name(branch), branch.address].join(' — ')}</p>
          ) : null}
          {store.deliveryEnabled ? (
            <Choice cards={cards}>
              <input
                type="radio"
                name="fulfillment"
                className="accent-primary"
                checked={fulfillment === 'delivery'}
                onChange={() => set({ fulfillment: 'delivery', scheduledFor: null })}
              />
              {cards ? <StoreIcon name="pin" className="size-5 text-fg-muted" /> : null}
              {t('checkout.delivery')}
              {store.deliveryAreas.length === 0 ? ` (${money(store.deliveryFee)})` : ''}
            </Choice>
          ) : null}
          {fulfillment === 'delivery' && store.deliveryAreas.length > 0 ? (
            <Field label={t('checkout.area')} error={required(missing.area)}>
              {(p) => (
                <Select
                  {...p}
                  value={values.areaId ?? ''}
                  onChange={(e) => set({ areaId: e.target.value || null, scheduledFor: null })}
                >
                  <option value="">{t('checkout.chooseArea')}</option>
                  {store.deliveryAreas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {name(a)} — {money(a.fee)}
                      {a.estimatedMinutes
                        ? ` · ${t('checkout.minutes', { count: a.estimatedMinutes })}`
                        : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          {area?.freeDeliveryFrom ? (
            <p className="text-sm text-fg-muted">
              {t('checkout.freeFrom', { amount: money(area.freeDeliveryFrom) })}
            </p>
          ) : null}
          {fulfillment === 'delivery' && token && addresses.length > 0 ? (
            <Field label={t('account.useSaved')}>
              {(p) => (
                <Select
                  {...p}
                  value={savedAddressId}
                  onChange={(e) => {
                    const chosen = addresses.find((a) => a.id === e.target.value) ?? null;
                    set({
                      savedAddressId: e.target.value,
                      deliveryAddress: chosen ? chosen.address : '',
                      areaId: chosen?.deliveryAreaId ?? null,
                    });
                  }}
                >
                  {addresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {[a.label, a.address].filter(Boolean).join(' — ')}
                    </option>
                  ))}
                  <option value="">{t('account.newAddress')}</option>
                </Select>
              )}
            </Field>
          ) : null}
          {fulfillment === 'delivery' ? (
            <Field label={t('checkout.address')} error={required(missing.address)}>
              {(p) => (
                <Textarea
                  {...p}
                  autoComplete="street-address"
                  value={values.deliveryAddress}
                  onChange={(e) => set({ deliveryAddress: e.target.value, savedAddressId: '' })}
                />
              )}
            </Field>
          ) : null}
          {fulfillment === 'delivery' && token && savedAddressId === '' ? (
            <Checkbox
              label={t('account.saveAddress')}
              checked={form.saveAddress}
              onChange={(e) => set({ saveAddress: e.target.checked })}
            />
          ) : null}
          {page.note.enabled ? (
            <Field label={text(page.note.label) || t('checkout.note')}>
              {(p) => (
                <Textarea
                  {...p}
                  value={form.note}
                  onChange={(e) => set({ note: e.target.value })}
                />
              )}
            </Field>
          ) : null}
        </fieldset>
        {showWhen ? (
          <fieldset className="flex flex-col gap-2">
            <Step n={3} steps={page.steps}>
              {t('checkout.when')}
            </Step>
            {closedNow ? <Alert tone="warning">{t('checkout.closedNow')}</Alert> : null}
            {store.scheduling.enabled ? (
              <SlotPicker
                branchId={branch?.id ?? null}
                fulfillment={fulfillment}
                value={form.scheduledFor}
                onChange={(scheduledFor) => set({ scheduledFor })}
                asapAllowed={!closedNow}
              />
            ) : null}
          </fieldset>
        ) : null}
        <fieldset className="flex flex-col gap-2">
          <Step n={showWhen ? 4 : 3} steps={page.steps}>
            {t('checkout.payment')}
          </Step>
          {store.paymentMethods.length === 0 && !store.payOnReceipt ? (
            <Alert tone="warning">{t('checkout.noMethods')}</Alert>
          ) : null}
          {store.paymentMethods.map((m) => (
            <Choice key={m.id} cards={cards}>
              <input
                type="radio"
                name="payment"
                className="accent-primary"
                checked={payment === m.id}
                onChange={() => set({ payment: m.id })}
              />
              {cards ? <StoreIcon name="card" className="size-5 text-fg-muted" /> : null}
              {name(m)}
            </Choice>
          ))}
          {store.payOnReceipt ? (
            <Choice cards={cards}>
              <input
                type="radio"
                name="payment"
                className="accent-primary"
                checked={payOnReceipt}
                onChange={() => set({ payment: ON_RECEIPT })}
              />
              {cards ? <StoreIcon name="bag" className="size-5 text-fg-muted" /> : null}
              {t(`checkout.payOnReceipt_${fulfillment}`)}
            </Choice>
          ) : null}
          {payOnReceipt ? (
            <p className="text-sm text-fg-muted">{t('checkout.payOnReceiptHint')}</p>
          ) : null}
        </fieldset>
      </div>
      <aside
        className={cn(
          'flex h-fit flex-col gap-3 rounded-lg border border-border bg-surface p-4',
          page.layout === 'split' && 'md:sticky md:top-24',
        )}
      >
        <h2 className="font-semibold">{t('checkout.summary')}</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {priced.map((l) => (
            <li key={l.variantId} className="flex items-center justify-between gap-2">
              {page.images ? (
                <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-muted text-fg-subtle">
                  {l.product.imageUrl ? (
                    <img src={l.product.imageUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <StoreIcon name="bag" className="size-4 opacity-50" />
                  )}
                </span>
              ) : null}
              <span className="min-w-0 flex-1">
                {l.quantity} × {[name(l.product), name(l.variant)].filter(Boolean).join(' — ')}
              </span>
              <span className="tabular-nums">{money(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
        {page.promo ? (
          <div className="flex flex-col gap-1">
            <Field label={t('checkout.promoCode')}>
              {(p) => (
                <div className="flex gap-2">
                  <Input
                    {...p}
                    dir="ltr"
                    autoComplete="off"
                    value={form.promoInput}
                    onChange={(e) => set({ promoInput: e.target.value.toUpperCase() })}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => set({ promotionCode: form.promoInput.trim() || null })}
                  >
                    {t('checkout.apply')}
                  </Button>
                </div>
              )}
            </Field>
            {quoted?.codeIssue ? (
              <p className="text-sm text-danger" data-testid="promo-issue">
                {t(`checkout.codeIssue_${quoted.codeIssue}`)}
              </p>
            ) : quoted?.promotion ? (
              <p className="text-sm text-success" data-testid="promo-applied">
                {t('checkout.promoApplied', { name: name(quoted.promotion) })}
              </p>
            ) : null}
          </div>
        ) : quoted?.promotion ? (
          <p className="text-sm text-success" data-testid="promo-applied">
            {t('checkout.promoApplied', { name: name(quoted.promotion) })}
          </p>
        ) : null}
        <dl className="flex flex-col gap-1 border-t border-border pt-2 text-sm">
          <div className="flex justify-between">
            <dt>{t('cart.subtotal')}</dt>
            <dd className="tabular-nums">{money(subtotal)}</dd>
          </div>
          {shownDiscount && !shownDiscount.isZero() ? (
            <div className="flex justify-between">
              <dt>{t('checkout.discount')}</dt>
              <dd className="tabular-nums" data-testid="checkout-discount">
                -{money(shownDiscount)}
              </dd>
            </div>
          ) : null}
          {fulfillment === 'delivery' ? (
            <div className="flex justify-between">
              <dt>{t('checkout.deliveryFee')}</dt>
              <dd className="tabular-nums">{money(shownDeliveryFee)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between text-base font-semibold">
            <dt>{t('checkout.total')}</dt>
            <dd className="tabular-nums" data-testid="checkout-total">
              {money(shownTotal)}
            </dd>
          </div>
        </dl>
        {page.terms.enabled ? (
          <div className="flex flex-col gap-1">
            <Checkbox
              label={text(page.terms.text) || t('checkout.terms')}
              checked={form.terms}
              onChange={(e) => set({ terms: e.target.checked })}
            />
            {termsLink ? (
              termsLink.external ? (
                <a
                  href={termsLink.to}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  {t('checkout.readTerms')}
                </a>
              ) : (
                <Link to={termsLink.to} className="text-xs text-primary hover:underline">
                  {t('checkout.readTerms')}
                </Link>
              )
            ) : null}
            {touched && missing.terms ? (
              <p className="text-sm text-danger">{t('checkout.termsRequired')}</p>
            ) : null}
          </div>
        ) : null}
        {checkout.isError ? <Alert tone="danger">{errorMessage(checkout.error)}</Alert> : null}
        <Button
          type="submit"
          size="lg"
          disabled={
            preview ||
            checkout.isPending ||
            !store.acceptingOrders ||
            !payment ||
            (closedNow && form.scheduledFor === null)
          }
        >
          {submitLabel}
        </Button>
        {!payOnReceipt ? <p className="text-xs text-fg-muted">{t('checkout.reserved')}</p> : null}
        <Highlights items={page.highlights} testId="checkout-highlights" />
      </aside>
    </form>
  );
}

/** "As soon as possible" or one of the branch's time slots for the next days (ADR-0123). */
function SlotPicker({
  branchId,
  fulfillment,
  value,
  onChange,
  asapAllowed,
}: {
  branchId: string | null;
  fulfillment: 'pickup' | 'delivery';
  value: string | null;
  onChange: (value: string | null) => void;
  asapAllowed: boolean;
}) {
  const api = useApi();
  const slug = useSlug();
  const { t, i18n } = useTranslation();
  const slots = useQuery({
    queryKey: ['store', slug, 'slots', branchId, fulfillment],
    queryFn: () => api.store.slots(slug, { branch: branchId, fulfillment }),
    staleTime: 60_000,
  });
  const open = slots.data?.slots.filter((s) => s.available) ?? [];
  return (
    <div className="flex flex-col gap-2">
      {asapAllowed ? (
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="when"
            className="accent-primary"
            checked={value === null}
            onChange={() => onChange(null)}
          />
          {t('checkout.asap')}
        </label>
      ) : null}
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name="when"
          className="accent-primary"
          checked={value !== null}
          disabled={open.length === 0}
          onChange={() => onChange(open[0]?.start ?? null)}
        />
        {t('checkout.schedule')}
      </label>
      {value !== null ? (
        <Field label={t('checkout.slot')}>
          {(p) => (
            <Select {...p} value={value} onChange={(e) => onChange(e.target.value)}>
              {open.map((s) => (
                <option key={s.start} value={s.start}>
                  {formatDateTime(s.start, i18n.language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      {slots.isSuccess && open.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('checkout.noSlots')}</p>
      ) : null}
    </div>
  );
}
