import { ApiError } from '@arabat/api-client';
import { formatDateTime } from '@arabat/i18n';
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from '@arabat/ui';
import { useApi, useErrorMessage } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { priceLines, useCart } from '../cart.js';
import {
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
  const [key, setKey] = useState(newKey);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    fulfillment: null as 'pickup' | 'delivery' | null,
    deliveryAddress: '',
    /** Delivery area (ADR-0123); required when the store defines areas. */
    areaId: null as string | null,
    /** Requested slot start, or null for "as soon as possible". */
    scheduledFor: null as string | null,
    note: '',
    /** A gateway method id, `ON_RECEIPT`, or null until chosen. */
    payment: null as string | null,
  });
  const [touched, setTouched] = useState(false);
  const { branch: pickupBranch, setBranchId } = useBranchChoice();

  const checkout = useMutation({
    mutationFn: (body: Parameters<typeof api.store.checkout>[1]) => api.store.checkout(slug, body),
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

  if (!store || products.isPending) return <Spinner label={t('common:status.loading')} />;
  if (!products.data || (cart.lines.length === 0 && !checkout.isSuccess))
    return <Navigate to={`/${slug}/cart`} replace />;

  const fulfillment = form.fulfillment ?? (store.pickupEnabled ? 'pickup' : 'delivery');
  const payment =
    form.payment ?? store.paymentMethods[0]?.id ?? (store.payOnReceipt ? ON_RECEIPT : null);
  const payOnReceipt = payment === ON_RECEIPT;
  const area =
    fulfillment === 'delivery'
      ? (store.deliveryAreas.find((a) => a.id === form.areaId) ?? null)
      : null;
  const { priced, subtotal, deliveryFee, total } = priceLines(
    cart.lines,
    products.data.products,
    store,
    fulfillment,
    store.deliveryAreas.length > 0 ? area : undefined,
  );
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const missing = {
    name: !form.name.trim(),
    phone: form.phone.trim().length < 6,
    address: fulfillment === 'delivery' && !form.deliveryAddress.trim(),
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
    if (missing.area) return;
    checkout.mutate({
      idempotencyKey: key,
      lines: priced.map((l) => ({ variantId: l.variantId, quantity: String(l.quantity) })),
      fulfillment,
      customer: { name: form.name, phone: form.phone, email: form.email || null },
      deliveryAddress: fulfillment === 'delivery' ? form.deliveryAddress : null,
      branchId: fulfillment === 'pickup' ? (pickupBranch?.id ?? null) : null,
      deliveryAreaId: area?.id ?? null,
      scheduledFor: form.scheduledFor,
      note: form.note || null,
      paymentMethodId: payOnReceipt ? null : payment,
      expectedTotal: total.toDecimalString(),
    });
  };
  const required = (bad: boolean) => (touched && bad ? t('checkout.required') : undefined);

  return (
    <form onSubmit={submit} className="grid gap-6 md:grid-cols-[1fr_20rem]" noValidate>
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{t('checkout.title')}</h1>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-semibold">{t('checkout.contact')}</legend>
          <Field label={t('checkout.name')} error={required(missing.name)}>
            {(p) => (
              <Input
                {...p}
                autoComplete="name"
                value={form.name}
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
                value={form.phone}
                onChange={(e) => set({ phone: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('checkout.email')}>
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="email"
                dir="ltr"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
              />
            )}
          </Field>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-semibold">{t('checkout.fulfillment')}</legend>
          {store.pickupEnabled ? (
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="fulfillment"
                className="accent-primary"
                checked={fulfillment === 'pickup'}
                onChange={() => set({ fulfillment: 'pickup', scheduledFor: null })}
              />
              {t('checkout.pickup')}
            </label>
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
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="fulfillment"
                className="accent-primary"
                checked={fulfillment === 'delivery'}
                onChange={() => set({ fulfillment: 'delivery', scheduledFor: null })}
              />
              {t('checkout.delivery')}
              {store.deliveryAreas.length === 0 ? ` (${money(store.deliveryFee)})` : ''}
            </label>
          ) : null}
          {fulfillment === 'delivery' && store.deliveryAreas.length > 0 ? (
            <Field label={t('checkout.area')} error={required(missing.area)}>
              {(p) => (
                <Select
                  {...p}
                  value={form.areaId ?? ''}
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
          {fulfillment === 'delivery' ? (
            <Field label={t('checkout.address')} error={required(missing.address)}>
              {(p) => (
                <Textarea
                  {...p}
                  autoComplete="street-address"
                  value={form.deliveryAddress}
                  onChange={(e) => set({ deliveryAddress: e.target.value })}
                />
              )}
            </Field>
          ) : null}
          <Field label={t('checkout.note')}>
            {(p) => (
              <Textarea {...p} value={form.note} onChange={(e) => set({ note: e.target.value })} />
            )}
          </Field>
        </fieldset>
        {store.scheduling.enabled || closedNow ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-semibold">{t('checkout.when')}</legend>
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
          <legend className="mb-2 font-semibold">{t('checkout.payment')}</legend>
          {store.paymentMethods.length === 0 && !store.payOnReceipt ? (
            <Alert tone="warning">{t('checkout.noMethods')}</Alert>
          ) : null}
          {store.paymentMethods.map((m) => (
            <label key={m.id} className="flex items-center gap-2">
              <input
                type="radio"
                name="payment"
                className="accent-primary"
                checked={payment === m.id}
                onChange={() => set({ payment: m.id })}
              />
              {name(m)}
            </label>
          ))}
          {store.payOnReceipt ? (
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="payment"
                className="accent-primary"
                checked={payOnReceipt}
                onChange={() => set({ payment: ON_RECEIPT })}
              />
              {t(`checkout.payOnReceipt_${fulfillment}`)}
            </label>
          ) : null}
          {payOnReceipt ? (
            <p className="text-sm text-fg-muted">{t('checkout.payOnReceiptHint')}</p>
          ) : null}
        </fieldset>
      </div>
      <aside className="flex h-fit flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="font-semibold">{t('checkout.summary')}</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {priced.map((l) => (
            <li key={l.variantId} className="flex justify-between gap-2">
              <span>
                {l.quantity} × {[name(l.product), name(l.variant)].filter(Boolean).join(' — ')}
              </span>
              <span className="tabular-nums">{money(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <dl className="flex flex-col gap-1 border-t border-border pt-2 text-sm">
          <div className="flex justify-between">
            <dt>{t('cart.subtotal')}</dt>
            <dd className="tabular-nums">{money(subtotal)}</dd>
          </div>
          {fulfillment === 'delivery' ? (
            <div className="flex justify-between">
              <dt>{t('checkout.deliveryFee')}</dt>
              <dd className="tabular-nums">{money(deliveryFee)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between text-base font-semibold">
            <dt>{t('checkout.total')}</dt>
            <dd className="tabular-nums" data-testid="checkout-total">
              {money(total)}
            </dd>
          </div>
        </dl>
        {checkout.isError ? <Alert tone="danger">{errorMessage(checkout.error)}</Alert> : null}
        <Button
          type="submit"
          size="lg"
          disabled={
            checkout.isPending ||
            !store.acceptingOrders ||
            !payment ||
            (closedNow && form.scheduledFor === null)
          }
        >
          {payOnReceipt ? t('checkout.submitOnReceipt') : t('checkout.submit')}
        </Button>
        {!payOnReceipt ? <p className="text-xs text-fg-muted">{t('checkout.reserved')}</p> : null}
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
