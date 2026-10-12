import { Button, Dialog, Field, Input, Spinner } from '@arabat/ui';
import { useApi, useAuth, useNotify } from '@arabat/web-core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCart } from './cart.js';

/** Customer chip above the cart: shows the selected customer or "walk-in". */
export function CustomerBar() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const cart = useCart();
  const [open, setOpen] = useState(false);
  const customer = cart.state.customer;
  if (!hasPermission('customers.read')) return null;
  return (
    <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
      <span className="min-w-0 truncate text-sm" data-testid="cart-customer">
        <span className="text-fg-muted">{t('customer.label')}: </span>
        {customer ? (
          <span className="font-medium">
            {customer.fullName}{' '}
            <span className="text-xs text-fg-muted" dir="ltr">
              {customer.code}
            </span>
          </span>
        ) : (
          t('customer.walkIn')
        )}
      </span>
      <span className="flex shrink-0 gap-1">
        {customer ? (
          <Button size="sm" variant="ghost" onClick={() => cart.setCustomer(null)}>
            {t('customer.remove')}
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {customer ? t('customer.change') : t('customer.choose')}
        </Button>
      </span>
      {open ? <CustomerDialog onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function CustomerDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const { hasPermission } = useAuth();
  const cart = useCart();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);
  const results = useQuery({
    queryKey: ['pos', 'customers', q],
    enabled: q.length > 0,
    queryFn: () => api.customers.posSearch(q),
  });
  const create = useMutation({
    mutationFn: () =>
      api.customers.posCreate({ fullName: fullName.trim(), phone: phone.trim() || null }),
    onSuccess: (c) => {
      cart.setCustomer({ id: c.id, code: c.code, fullName: c.fullName });
      notify.ok(t('customer.created'));
      onClose();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={creating ? t('customer.new') : t('customer.choose')}
      footer={
        creating ? (
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              {t('common.back')}
            </Button>
            <Button
              disabled={!fullName.trim()}
              loading={create.isPending}
              onClick={() => create.mutate()}
            >
              {t('customer.save')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            {hasPermission('customers.create') ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setCreating(true);
                  if (/\d/.test(search)) setPhone(search.trim());
                  else setFullName(search.trim());
                }}
              >
                {t('customer.new')}
              </Button>
            ) : null}
          </>
        )
      }
    >
      {creating ? (
        <div className="grid gap-3">
          <Field label={t('customer.fullName')}>
            {(p) => <Input {...p} value={fullName} onChange={(e) => setFullName(e.target.value)} />}
          </Field>
          <Field label={t('customer.phone')}>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            )}
          </Field>
        </div>
      ) : (
        <div className="grid gap-3">
          <Input
            type="search"
            autoFocus
            aria-label={t('customer.search')}
            placeholder={t('customer.search')}
            className="h-12 text-lg"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {results.isFetching ? <Spinner /> : null}
          {q && results.data?.customers.length === 0 ? (
            <p className="text-fg-muted">{t('customer.noMatch')}</p>
          ) : null}
          <ul className="divide-y divide-border" aria-label={t('customer.results')}>
            {results.data?.customers.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="flex h-14 w-full items-center justify-between gap-3 px-1 text-start hover:bg-surface-muted"
                  onClick={() => {
                    cart.setCustomer({ id: c.id, code: c.code, fullName: c.fullName });
                    onClose();
                  }}
                >
                  <span className="font-medium">{c.fullName}</span>
                  <span className="text-sm text-fg-muted" dir="ltr">
                    {c.phone ?? c.code}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
