import { storePath } from '../address.js';
import { ApiError } from '@arabat/api-client';
import type { CustomerAddress } from '@arabat/contracts';
import { formatDateTime } from '@arabat/i18n';
import { Alert, Badge, Button, Checkbox, Field, Input, Select, Spinner } from '@arabat/ui';
import { useApi, useErrorMessage } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, NavLink, Outlet, useNavigate, useParams } from 'react-router';
import { useAccount, useLocalName, useMoney, useSlug, useStorefront } from '../shared.js';

/** Shell of the account area (ADR-0124): tabs for orders, addresses and the profile. */
export function AccountLayout() {
  const slug = useSlug();
  const { t } = useTranslation();
  const { token, account, isPending, signOut } = useAccount();
  const { data: store } = useStorefront();
  const navigate = useNavigate();
  if (store && !store.accountsEnabled && !token) return <Navigate to={storePath(slug)} replace />;
  if (!token) return <SignInPage />;
  if (isPending) return <Spinner label={t('common:status.loading')} />;
  const tab = (to: string, label: string) => (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-primary text-primary-fg' : 'hover:bg-surface-muted'}`
      }
    >
      {label}
    </NavLink>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">
          {t('account.hello', { name: account?.fullName ?? '' })}
        </h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void signOut().then(() => navigate(storePath(slug)));
          }}
        >
          {t('account.signOut')}
        </Button>
      </div>
      <nav className="flex flex-wrap gap-1" aria-label={t('account.title')}>
        {tab(storePath(slug, `/account`), t('account.orders'))}
        {tab(storePath(slug, `/account/addresses`), t('account.addresses'))}
        {tab(storePath(slug, `/account/profile`), t('account.profile'))}
      </nav>
      <Outlet />
    </div>
  );
}

/** Sign in or create an account (the same page, two forms). */
function SignInPage() {
  const api = useApi();
  const slug = useSlug();
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const { setToken } = useAccount();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', password: '' });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const submit = useMutation({
    mutationFn: () =>
      mode === 'login'
        ? api.store.account.login(slug, { email: form.email, password: form.password })
        : api.store.account.register(slug, form),
    onSuccess: ({ token }) => setToken(token),
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate();
  };
  const issue = (field: string) =>
    submit.error instanceof ApiError
      ? (submit.error.problem as { issues?: { path: string; message: string }[] }).issues?.find(
          (i) => i.path === field,
        )?.message
      : undefined;
  return (
    <form onSubmit={onSubmit} className="mx-auto flex max-w-md flex-col gap-4" noValidate>
      <h1 className="text-2xl font-semibold">
        {mode === 'login' ? t('account.signIn') : t('account.register')}
      </h1>
      <div className="flex gap-2" role="group">
        <Button
          type="button"
          size="sm"
          variant={mode === 'login' ? 'primary' : 'secondary'}
          onClick={() => setMode('login')}
        >
          {t('account.signIn')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === 'register' ? 'primary' : 'secondary'}
          onClick={() => setMode('register')}
        >
          {t('account.register')}
        </Button>
      </div>
      {mode === 'register' ? (
        <>
          <Field label={t('checkout.name')} error={issue('fullName')}>
            {(p) => (
              <Input
                {...p}
                autoComplete="name"
                value={form.fullName}
                onChange={(e) => set({ fullName: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('checkout.phone')} error={issue('phone')}>
            {(p) => (
              <Input
                {...p}
                type="tel"
                dir="ltr"
                autoComplete="tel"
                value={form.phone}
                onChange={(e) => set({ phone: e.target.value })}
              />
            )}
          </Field>
        </>
      ) : null}
      <Field label={t('account.email')} error={issue('email')}>
        {(p) => (
          <Input
            {...p}
            type="email"
            dir="ltr"
            autoComplete="email"
            value={form.email}
            onChange={(e) => set({ email: e.target.value })}
          />
        )}
      </Field>
      <Field
        label={t('account.password')}
        hint={mode === 'register' ? t('account.passwordHint') : undefined}
        error={issue('password')}
      >
        {(p) => (
          <Input
            {...p}
            type="password"
            dir="ltr"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={form.password}
            onChange={(e) => set({ password: e.target.value })}
          />
        )}
      </Field>
      {submit.isError ? <Alert tone="danger">{errorMessage(submit.error)}</Alert> : null}
      <Button type="submit" size="lg" loading={submit.isPending}>
        {mode === 'login' ? t('account.signIn') : t('account.createAccount')}
      </Button>
      {mode === 'login' ? (
        <Link
          to={storePath(slug, `/account/forgot`)}
          className="text-sm text-primary hover:underline"
        >
          {t('account.forgot')}
        </Link>
      ) : null}
    </form>
  );
}

export function AccountOrdersPage() {
  const api = useApi();
  const slug = useSlug();
  const { token } = useAccount();
  const money = useMoney();
  const { t, i18n } = useTranslation();
  const orders = useQuery({
    queryKey: ['store', slug, 'account', 'orders', token],
    queryFn: () => api.store.account.orders(slug, token!),
    enabled: token !== null,
  });
  if (orders.isPending) return <Spinner label={t('common:status.loading')} />;
  if (orders.isError) return <Alert tone="danger">{t('account.ordersFailed')}</Alert>;
  if (orders.data.orders.length === 0)
    return <p className="text-fg-muted">{t('account.noOrders')}</p>;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
      {orders.data.orders.map((o) => (
        <li key={o.number} className="flex flex-wrap items-center justify-between gap-2 p-3">
          <span>
            <Link
              to={storePath(slug, `/orders/${o.trackingToken}`)}
              className="font-medium text-primary hover:underline"
              dir="ltr"
            >
              {o.number}
            </Link>
            <span className="block text-sm text-fg-muted">
              {formatDateTime(o.createdAt, i18n.language)} · {t(`order.${o.fulfillment}`)} ·{' '}
              {t('account.items', { count: o.lineCount })}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <Badge>{t(`status.${o.status}`)}</Badge>
            <span className="tabular-nums">{money(o.total)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AccountAddressesPage() {
  const api = useApi();
  const slug = useSlug();
  const queryClient = useQueryClient();
  const { token, addresses } = useAccount();
  const { data: store } = useStorefront();
  const name = useLocalName();
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [editing, setEditing] = useState<CustomerAddress | 'new' | null>(null);
  const [form, setForm] = useState({
    label: '',
    deliveryAreaId: '',
    address: '',
    isDefault: false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['store', slug, 'account'] });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        label: form.label || null,
        deliveryAreaId: form.deliveryAreaId || null,
        address: form.address,
        isDefault: form.isDefault,
      };
      return editing && editing !== 'new'
        ? api.store.account.updateAddress(slug, token!, editing.id, body)
        : api.store.account.addAddress(slug, token!, body);
    },
    onSuccess: async () => {
      setEditing(null);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.store.account.deleteAddress(slug, token!, id),
    onSuccess: refresh,
  });
  const open = (a: CustomerAddress | 'new') => {
    setEditing(a);
    setForm(
      a === 'new'
        ? { label: '', deliveryAreaId: '', address: '', isDefault: addresses.length === 0 }
        : {
            label: a.label ?? '',
            deliveryAreaId: a.deliveryAreaId ?? '',
            address: a.address,
            isDefault: a.isDefault,
          },
    );
  };
  return (
    <div className="flex flex-col gap-4">
      {addresses.length === 0 ? (
        <p className="text-fg-muted">{t('account.noAddresses')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {addresses.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span>
                <span className="font-medium">
                  {a.label ?? t('account.address')}
                  {a.isDefault ? ` · ${t('account.default')}` : ''}
                </span>
                <span className="block text-sm text-fg-muted">
                  {[
                    store?.deliveryAreas.find((x) => x.id === a.deliveryAreaId)
                      ? name(store.deliveryAreas.find((x) => x.id === a.deliveryAreaId)!)
                      : null,
                    a.address,
                  ]
                    .filter(Boolean)
                    .join(' — ')}
                </span>
              </span>
              <span className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => open(a)}>
                  {t('account.edit')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(a.id)}>
                  {t('account.delete')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <form
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label={t('account.label')}>
            {(p) => (
              <Input
                {...p}
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            )}
          </Field>
          {store && store.deliveryAreas.length > 0 ? (
            <Field label={t('checkout.area')}>
              {(p) => (
                <Select
                  {...p}
                  value={form.deliveryAreaId}
                  onChange={(e) => setForm({ ...form, deliveryAreaId: e.target.value })}
                >
                  <option value="">—</option>
                  {store.deliveryAreas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {name(a)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label={t('checkout.address')}>
            {(p) => (
              <Input
                {...p}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            )}
          </Field>
          <Checkbox
            label={t('account.makeDefault')}
            checked={form.isDefault}
            onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
          />
          {save.isError ? <Alert tone="danger">{errorMessage(save.error)}</Alert> : null}
          <div className="flex gap-2">
            <Button type="submit" loading={save.isPending} disabled={!form.address.trim()}>
              {t('account.save')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
              {t('account.cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button onClick={() => open('new')}>{t('account.addAddress')}</Button>
        </div>
      )}
    </div>
  );
}

export function AccountProfilePage() {
  const api = useApi();
  const slug = useSlug();
  const queryClient = useQueryClient();
  const { token, account } = useAccount();
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [profile, setProfile] = useState({
    fullName: account?.fullName ?? '',
    phone: account?.phone ?? '',
  });
  const [pw, setPw] = useState({ current: '', next: '' });
  const saveProfile = useMutation({
    mutationFn: () => api.store.account.update(slug, token!, profile),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['store', slug, 'account'] }),
  });
  const savePassword = useMutation({
    mutationFn: () => api.store.account.changePassword(slug, token!, pw),
    onSuccess: () => setPw({ current: '', next: '' }),
  });
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          saveProfile.mutate();
        }}
      >
        <h2 className="font-semibold">{t('account.profile')}</h2>
        <Field label={t('checkout.name')}>
          {(p) => (
            <Input
              {...p}
              value={profile.fullName}
              onChange={(e) => setProfile({ ...profile, fullName: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('checkout.phone')}>
          {(p) => (
            <Input
              {...p}
              type="tel"
              dir="ltr"
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
            />
          )}
        </Field>
        <p className="text-sm text-fg-muted" dir="ltr">
          {account?.email}
        </p>
        {saveProfile.isError ? (
          <Alert tone="danger">{errorMessage(saveProfile.error)}</Alert>
        ) : null}
        {saveProfile.isSuccess ? <Alert tone="success">{t('account.saved')}</Alert> : null}
        <Button type="submit" loading={saveProfile.isPending}>
          {t('account.save')}
        </Button>
      </form>
      <form
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          savePassword.mutate();
        }}
      >
        <h2 className="font-semibold">{t('account.changePassword')}</h2>
        <Field label={t('account.currentPassword')}>
          {(p) => (
            <Input
              {...p}
              type="password"
              dir="ltr"
              autoComplete="current-password"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('account.newPassword')} hint={t('account.passwordHint')}>
          {(p) => (
            <Input
              {...p}
              type="password"
              dir="ltr"
              autoComplete="new-password"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
            />
          )}
        </Field>
        {savePassword.isError ? (
          <Alert tone="danger">{errorMessage(savePassword.error)}</Alert>
        ) : null}
        {savePassword.isSuccess ? (
          <Alert tone="success">{t('account.passwordChanged')}</Alert>
        ) : null}
        <Button type="submit" loading={savePassword.isPending} disabled={pw.next.length < 8}>
          {t('account.changePassword')}
        </Button>
      </form>
    </div>
  );
}

export function ForgotPasswordPage() {
  const api = useApi();
  const slug = useSlug();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const send = useMutation({ mutationFn: () => api.store.account.forgot(slug, email) });
  return (
    <form
      className="mx-auto flex max-w-md flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      <h1 className="text-2xl font-semibold">{t('account.forgotTitle')}</h1>
      {send.isSuccess ? (
        <Alert tone="success">{t('account.forgotSent')}</Alert>
      ) : (
        <>
          <Field label={t('account.email')}>
            {(p) => (
              <Input
                {...p}
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" loading={send.isPending}>
            {t('account.sendLink')}
          </Button>
        </>
      )}
      <Link to={storePath(slug, `/account`)} className="text-sm text-primary hover:underline">
        {t('account.backToSignIn')}
      </Link>
    </form>
  );
}

export function ResetPasswordPage() {
  const api = useApi();
  const slug = useSlug();
  const { token = '' } = useParams();
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [password, setPassword] = useState('');
  const reset = useMutation({
    mutationFn: () => api.store.account.reset(slug, { token, password }),
  });
  return (
    <form
      className="mx-auto flex max-w-md flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        reset.mutate();
      }}
    >
      <h1 className="text-2xl font-semibold">{t('account.resetTitle')}</h1>
      {reset.isSuccess ? (
        <>
          <Alert tone="success">{t('account.resetDone')}</Alert>
          <Link to={storePath(slug, `/account`)} className="text-sm text-primary hover:underline">
            {t('account.backToSignIn')}
          </Link>
        </>
      ) : (
        <>
          <Field label={t('account.newPassword')} hint={t('account.passwordHint')}>
            {(p) => (
              <Input
                {...p}
                type="password"
                dir="ltr"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          {reset.isError ? <Alert tone="danger">{errorMessage(reset.error)}</Alert> : null}
          <Button type="submit" loading={reset.isPending} disabled={password.length < 8}>
            {t('account.resetButton')}
          </Button>
        </>
      )}
    </form>
  );
}
