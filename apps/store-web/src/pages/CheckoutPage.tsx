import { ApiError } from '@arabat/api-client';
import { Alert, Button, Field, Input, Spinner, Textarea } from '@arabat/ui';
import { useApi, useErrorMessage } from '@arabat/web-core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { priceLines, useCart } from '../cart.js';
import { useLocalName, useMoney, useSlug, useStoreProducts, useStorefront } from '../shared.js';

const newKey = () => globalThis.crypto.randomUUID();

/**
 * Checkout: the server re-prices the cart, reserves the stock and starts the payment; the
 * shopper is then sent to the gateway's page. The idempotency key is kept across retries
 * of the same submission (network errors) and renewed when the server refused it.
 */
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
    note: '',
    paymentMethodId: null as string | null,
  });
  const [touched, setTouched] = useState(false);

  const checkout = useMutation({
    mutationFn: (body: Parameters<typeof api.store.checkout>[1]) => api.store.checkout(slug, body),
    onSuccess: ({ order }) => {
      cart.clear();
      if (order.paymentUrl) window.location.assign(order.paymentUrl);
      else void navigate(`/${slug}/orders/${order.trackingToken}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status < 500) {
        setKey(newKey());
        void queryClient.invalidateQueries({ queryKey: ['store', slug, 'products'] });
      }
    },
  });

  if (!store || products.isPending) return <Spinner label={t('common:status.loading')} />;
  if (!products.data || cart.lines.length === 0) return <Navigate to={`/${slug}/cart`} replace />;

  const fulfillment = form.fulfillment ?? (store.pickupEnabled ? 'pickup' : 'delivery');
  const paymentMethodId = form.paymentMethodId ?? store.paymentMethods[0]?.id ?? null;
  const { priced, subtotal, deliveryFee, total } = priceLines(
    cart.lines,
    products.data.products,
    store,
    fulfillment,
  );
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const missing = {
    name: !form.name.trim(),
    phone: form.phone.trim().length < 6,
    address: fulfillment === 'delivery' && !form.deliveryAddress.trim(),
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (missing.name || missing.phone || missing.address || !paymentMethodId) return;
    checkout.mutate({
      idempotencyKey: key,
      lines: priced.map((l) => ({ variantId: l.variantId, quantity: String(l.quantity) })),
      fulfillment,
      customer: { name: form.name, phone: form.phone, email: form.email || null },
      deliveryAddress: fulfillment === 'delivery' ? form.deliveryAddress : null,
      note: form.note || null,
      paymentMethodId,
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
                onChange={() => set({ fulfillment: 'pickup' })}
              />
              {t('checkout.pickup')}
            </label>
          ) : null}
          {store.deliveryEnabled ? (
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="fulfillment"
                className="accent-primary"
                checked={fulfillment === 'delivery'}
                onChange={() => set({ fulfillment: 'delivery' })}
              />
              {t('checkout.delivery')} ({money(store.deliveryFee)})
            </label>
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
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-semibold">{t('checkout.payment')}</legend>
          {store.paymentMethods.length === 0 ? (
            <Alert tone="warning">{t('checkout.noMethods')}</Alert>
          ) : (
            store.paymentMethods.map((m) => (
              <label key={m.id} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="payment"
                  className="accent-primary"
                  checked={paymentMethodId === m.id}
                  onChange={() => set({ paymentMethodId: m.id })}
                />
                {name(m)}
              </label>
            ))
          )}
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
          disabled={checkout.isPending || !store.acceptingOrders || !paymentMethodId}
        >
          {t('checkout.submit')}
        </Button>
        <p className="text-xs text-fg-muted">{t('checkout.reserved')}</p>
      </aside>
    </form>
  );
}
