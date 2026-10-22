import type {
  ProductDiscount,
  ProductDiscountPreview,
  SaveProductDiscount,
} from '@arabat/contracts';
import { saveProductDiscountSchema } from '@arabat/contracts';
import { formatDateTime, formatMoney } from '@arabat/i18n';
import { Money } from '@arabat/money';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  Field,
  Icon,
  Input,
  PageHeader,
  Segmented,
  cn,
} from '@arabat/ui';
import { AccessDenied, ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../app/context.js';
import { key } from '../shared.js';

/*
 * Product discounts (ADR-0133): a percentage or an amount off chosen products, in the online
 * store and at the point of sale at the same time, optionally between two dates. The largest
 * discount in force wins; nothing changes the catalog prices.
 */

const listKey = [...key, 'discounts'] as const;
type Filter = 'all' | 'running' | 'scheduled' | 'ended' | 'paused';
const STATE_TONE = {
  running: 'success',
  scheduled: 'primary',
  ended: 'neutral',
  paused: 'warning',
  archived: 'neutral',
} as const;

const money = (m: { amount: string; currency: string }, language: string) =>
  formatMoney(Money.fromJSON(m as { amount: string; currency: 'KWD' }), language);

export function DiscountsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  if (!can('online.manage')) return <AccessDenied />;
  return (
    <div>
      <PageHeader title={t('nav.discounts')} description={t('discounts.hint')} />
      <DiscountList />
    </div>
  );
}

function DiscountList() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const manage = can('catalog.prices.manage');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<ProductDiscount | 'new' | null>(null);
  const discounts = useQuery({ queryKey: listKey, queryFn: () => api.online.discounts() });
  const status = useMutation({
    mutationFn: (v: { id: string; status: 'active' | 'paused' | 'archived' }) =>
      api.online.setDiscountStatus(v.id, v.status),
    onSuccess: async (d) => {
      await queryClient.invalidateQueries({ queryKey: key });
      notify.ok(t(`discounts.state_${d.state}`));
    },
    onError: notify.fail,
  });
  if (discounts.isPending) return null;
  if (discounts.isError)
    return <ErrorState error={discounts.error} onRetry={() => void discounts.refetch()} />;
  const all = discounts.data.discounts;
  const live = all.filter((d) => d.state !== 'archived');
  const shown = filter === 'all' ? live : live.filter((d) => d.state === filter);
  const count = (f: Filter) =>
    f === 'all' ? live.length : live.filter((d) => d.state === f).length;
  return (
    <div className="flex flex-col gap-4">
      {!manage ? <Alert tone="info">{t('discounts.readOnly')}</Alert> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t('discounts.filter')}
          value={filter}
          onChange={setFilter}
          options={(['all', 'running', 'scheduled', 'ended', 'paused'] as const).map((f) => ({
            value: f,
            label: `${t(`discounts.filter_${f}`)} (${count(f)})`,
          }))}
        />
        {manage ? (
          <Button onClick={() => setEditing('new')}>
            <Icon name="discount" className="size-4" />
            {t('discounts.add')}
          </Button>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <EmptyState
          title={live.length === 0 ? t('discounts.none') : t('discounts.noneHere')}
          description={live.length === 0 ? t('discounts.noneHint') : undefined}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" data-testid="discount-list">
          {shown.map((d) => (
            <li
              key={d.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
              data-testid="discount"
            >
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    'grid size-14 shrink-0 place-items-center rounded-xl text-lg font-extrabold tabular-nums',
                    d.state === 'running'
                      ? 'bg-danger text-white'
                      : 'bg-surface-muted text-fg-muted',
                  )}
                  dir="ltr"
                >
                  {d.type === 'percentage' ? (
                    `-${Number(d.percent)}%`
                  ) : (
                    <span className="text-xs leading-tight">-{d.amount?.amount}</span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold">
                      {localizedName(d, i18n.language)}
                    </span>
                    <Badge tone={STATE_TONE[d.state]}>{t(`discounts.state_${d.state}`)}</Badge>
                  </p>
                  <p className="text-sm text-fg-muted">
                    {d.type === 'percentage'
                      ? t('discounts.percentOff', { percent: Number(d.percent) })
                      : t('discounts.amountOff', { amount: money(d.amount!, i18n.language) })}
                    {' · '}
                    {t(`discounts.appliesShort_${d.appliesTo}`, { count: d.targetIds.length })}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {d.online ? <Badge tone="primary">{t('discounts.online')}</Badge> : null}
                {d.pos ? <Badge tone="primary">{t('discounts.pos')}</Badge> : null}
                <Badge>{t('discounts.productCount', { count: d.productCount })}</Badge>
              </div>
              <p className="text-xs text-fg-muted">
                {d.startsAt
                  ? t('discounts.from', { time: formatDateTime(d.startsAt, i18n.language) })
                  : t('discounts.fromNow')}
                {' — '}
                {d.endsAt
                  ? t('discounts.until', { time: formatDateTime(d.endsAt, i18n.language) })
                  : t('discounts.noEnd')}
              </p>
              {manage ? (
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(d)}>
                    {t('products.edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={status.isPending && status.variables?.id === d.id}
                    onClick={() =>
                      status.mutate({
                        id: d.id,
                        status: d.status === 'paused' ? 'active' : 'paused',
                      })
                    }
                  >
                    {d.status === 'paused' ? t('discounts.resume') : t('discounts.pause')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ms-auto text-fg-muted"
                    onClick={() => {
                      if (window.confirm(t('discounts.archiveConfirm')))
                        status.mutate({ id: d.id, status: 'archived' });
                    }}
                  >
                    {t('discounts.archive')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <DiscountDialog
          discount={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: key });
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);
const QUICK_PERCENT = ['10', '15', '20', '25', '30', '40', '50'];
const QUICK_END = [
  { key: 'day', ms: 24 * 3600_000 },
  { key: 'week', ms: 7 * 24 * 3600_000 },
  { key: 'month', ms: 30 * 24 * 3600_000 },
] as const;

/** Waits until a value has stopped changing for a moment (the preview asks the server). */
function useSettled<T>(value: T, ms = 400): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

function DiscountDialog({
  discount,
  onClose,
  onSaved,
}: {
  discount: ProductDiscount | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const [v, setV] = useState<SaveProductDiscount>({
    nameAr: discount?.nameAr ?? null,
    nameEn: discount?.nameEn ?? null,
    type: discount?.type ?? 'percentage',
    percent: discount?.percent ? String(Number(discount.percent)) : '20',
    amount: discount?.amount?.amount ?? null,
    appliesTo: discount?.appliesTo ?? 'all',
    targetIds: discount?.targetIds ?? [],
    online: discount?.online ?? true,
    pos: discount?.pos ?? true,
    startsAt: discount?.startsAt ?? null,
    endsAt: discount?.endsAt ?? null,
    status: discount?.status === 'paused' ? 'paused' : 'active',
  });
  const set = (patch: Partial<SaveProductDiscount>) => setV((x) => ({ ...x, ...patch }));
  const [search, setSearch] = useState('');
  const [belowCostOk, setBelowCostOk] = useState(false);
  const categories = useQuery({
    queryKey: [...key, 'categories'],
    queryFn: () => api.online.categories(),
    enabled: v.appliesTo === 'categories',
  });
  const collections = useQuery({
    queryKey: [...key, 'collections'],
    queryFn: () => api.online.collections(),
    enabled: v.appliesTo === 'collections',
  });
  const listings = useQuery({
    queryKey: [...key, 'listings'],
    queryFn: () => api.online.listings(),
    enabled: v.appliesTo === 'products',
  });
  const targets = useMemo(() => {
    const lang = i18n.language;
    if (v.appliesTo === 'categories')
      return (categories.data?.categories ?? []).map((c) => ({
        id: c.id,
        label: localizedName(c, lang),
        sub: null as string | null,
      }));
    if (v.appliesTo === 'collections')
      return (collections.data?.collections ?? []).map((c) => ({
        id: c.id,
        label: localizedName(c, lang),
        sub: null as string | null,
      }));
    if (v.appliesTo === 'products')
      return (listings.data?.products ?? []).map((p) => ({
        id: p.productId,
        label: localizedName(p, lang),
        sub: p.price ? money(p.price, lang) : null,
      }));
    return [];
  }, [v.appliesTo, categories.data, collections.data, listings.data, i18n.language]);
  const term = search.trim().toLowerCase();
  const visibleTargets = term
    ? targets.filter((x) => x.label.toLowerCase().includes(term))
    : targets;
  const chosen = new Set(v.targetIds ?? []);
  const toggle = (id: string, on: boolean) =>
    set({ targetIds: on ? [...chosen, id] : [...chosen].filter((x) => x !== id) });

  // What the discount would do, asked once the form has settled and is valid.
  const settled = useSettled(v);
  const valid = saveProductDiscountSchema.safeParse({ ...settled, nameAr: settled.nameAr || 'x' });
  const preview = useQuery<ProductDiscountPreview>({
    queryKey: [...listKey, 'preview', settled],
    queryFn: () => api.online.previewDiscount({ ...settled, nameAr: settled.nameAr || 'x' }),
    enabled: valid.success,
    placeholderData: (previous) => previous,
  });
  const belowCost = valid.success ? (preview.data?.belowCost ?? 0) : 0;

  const save = useMutation({
    mutationFn: () =>
      discount
        ? api.online.updateDiscount(discount.id, { ...v, version: discount.version })
        : api.online.createDiscount(v),
    onSuccess: async () => {
      notify.ok(t('common.saved'));
      await onSaved();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => (!open ? onClose() : undefined)}
      size="lg"
      title={discount ? t('discounts.editTitle') : t('discounts.add')}
      description={t('discounts.dialogHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={belowCost > 0 && !belowCostOk}
            onClick={() => save.mutate()}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('discounts.nameAr')} hint={t('discounts.nameHint')}>
            {(p) => (
              <Input
                {...p}
                value={v.nameAr ?? ''}
                placeholder={t('discounts.namePlaceholder')}
                onChange={(e) => set({ nameAr: e.target.value || null })}
              />
            )}
          </Field>
          <Field label={t('discounts.nameEn')}>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                value={v.nameEn ?? ''}
                onChange={(e) => set({ nameEn: e.target.value || null })}
              />
            )}
          </Field>
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-semibold">{t('discounts.value')}</legend>
          <Segmented
            label={t('discounts.value')}
            value={v.type}
            onChange={(type) => set({ type })}
            options={[
              { value: 'percentage', label: t('discounts.type_percentage') },
              { value: 'amount', label: t('discounts.type_amount') },
            ]}
          />
          {v.type === 'percentage' ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t('discounts.percent')} className="w-32">
                {(p) => (
                  <Input
                    {...p}
                    dir="ltr"
                    inputMode="decimal"
                    value={v.percent ?? ''}
                    onChange={(e) => set({ percent: e.target.value || null })}
                  />
                )}
              </Field>
              <div
                className="flex flex-wrap gap-1.5 pb-1"
                role="group"
                aria-label={t('discounts.quick')}
              >
                {QUICK_PERCENT.map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => set({ percent: pct })}
                    className={cn(
                      'rounded-full border px-3 py-1 text-sm font-semibold tabular-nums',
                      v.percent === pct
                        ? 'border-danger bg-danger text-white'
                        : 'border-border hover:border-danger hover:text-danger',
                    )}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <Field label={t('discounts.amount')} hint={t('discounts.amountHint')} className="w-48">
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  inputMode="decimal"
                  placeholder="0.500"
                  value={v.amount ?? ''}
                  onChange={(e) => set({ amount: e.target.value || null })}
                />
              )}
            </Field>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-semibold">{t('discounts.appliesTo')}</legend>
          <Segmented
            label={t('discounts.appliesTo')}
            value={v.appliesTo}
            onChange={(appliesTo) => {
              set({ appliesTo, targetIds: [] });
              setSearch('');
            }}
            options={(['all', 'categories', 'collections', 'products'] as const).map((a) => ({
              value: a,
              label: t(`discounts.applies_${a}`),
            }))}
          />
          {v.appliesTo !== 'all' ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="min-w-40 flex-1"
                  value={search}
                  placeholder={t('discounts.search')}
                  aria-label={t('discounts.search')}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    set({
                      targetIds: [...new Set([...chosen, ...visibleTargets.map((x) => x.id)])],
                    })
                  }
                >
                  {t('discounts.selectAll')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => set({ targetIds: [] })}>
                  {t('discounts.clear')}
                </Button>
                <Badge tone={chosen.size ? 'primary' : 'neutral'}>
                  {t('discounts.chosen', { count: chosen.size })}
                </Badge>
              </div>
              {targets.length === 0 ? (
                <p className="text-sm text-fg-muted">{t(`discounts.noTargets_${v.appliesTo}`)}</p>
              ) : (
                <div className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
                  {visibleTargets.map((x) => (
                    <Checkbox
                      key={x.id}
                      label={x.label}
                      description={x.sub ?? undefined}
                      checked={chosen.has(x.id)}
                      onChange={(e) => toggle(x.id, e.target.checked)}
                    />
                  ))}
                </div>
              )}
              {v.appliesTo === 'categories' ? (
                <p className="text-xs text-fg-muted">{t('discounts.subcategories')}</p>
              ) : null}
            </div>
          ) : null}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">{t('discounts.where')}</legend>
          <div className="flex flex-wrap gap-4">
            <Checkbox
              label={t('discounts.online')}
              description={t('discounts.onlineHint')}
              checked={v.online ?? true}
              onChange={(e) => set({ online: e.target.checked })}
            />
            <Checkbox
              label={t('discounts.pos')}
              description={t('discounts.posHint')}
              checked={v.pos ?? true}
              onChange={(e) => set({ pos: e.target.checked })}
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-semibold">{t('discounts.when')}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('discounts.startsAt')} hint={t('discounts.startsHint')}>
              {(p) => (
                <Input
                  {...p}
                  type="datetime-local"
                  dir="ltr"
                  value={toLocalInput(v.startsAt)}
                  onChange={(e) => set({ startsAt: fromLocalInput(e.target.value) })}
                />
              )}
            </Field>
            <Field label={t('discounts.endsAt')} hint={t('discounts.endsHint')}>
              {(p) => (
                <Input
                  {...p}
                  type="datetime-local"
                  dir="ltr"
                  value={toLocalInput(v.endsAt)}
                  onChange={(e) => set({ endsAt: fromLocalInput(e.target.value) })}
                />
              )}
            </Field>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('discounts.quickEnd')}>
            {QUICK_END.map((q) => (
              <Button
                key={q.key}
                size="sm"
                variant="secondary"
                onClick={() => {
                  const now = Date.now();
                  const from = v.startsAt ? Date.parse(v.startsAt) : now;
                  set({ endsAt: new Date(Math.max(from, now) + q.ms).toISOString() });
                }}
              >
                {t(`discounts.end_${q.key}`)}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => set({ endsAt: null })}>
              {t('discounts.noEnd')}
            </Button>
          </div>
        </fieldset>

        <section
          className="flex flex-col gap-3 rounded-xl bg-surface-muted p-4"
          aria-live="polite"
          data-testid="discount-preview"
        >
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Icon name="discount" className="size-4" />
            {t('discounts.previewTitle')}
          </p>
          {!valid.success ? (
            <p className="text-sm text-fg-muted">{t('discounts.previewWaiting')}</p>
          ) : preview.data ? (
            <>
              <p className="text-sm">
                {t('discounts.previewProducts', { count: preview.data.products })}
                {preview.data.unchanged > 0
                  ? ` ${t('discounts.previewUnchanged', { count: preview.data.unchanged })}`
                  : ''}
              </p>
              {preview.data.samples.length > 0 ? (
                <ul className="flex max-h-48 flex-col divide-y divide-border overflow-y-auto rounded-lg bg-surface text-sm">
                  {preview.data.samples.map((s) => (
                    <li
                      key={s.productId}
                      className="flex items-center justify-between gap-3 px-3 py-1.5"
                    >
                      <span className="min-w-0 truncate">{localizedName(s, i18n.language)}</span>
                      <span className="flex shrink-0 items-baseline gap-2 tabular-nums" dir="ltr">
                        <s className="text-xs text-fg-muted">{money(s.price, i18n.language)}</s>
                        <span
                          className={cn(
                            'font-semibold',
                            s.belowCost ? 'text-danger' : 'text-success',
                          )}
                        >
                          {money(s.discountedPrice, i18n.language)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {belowCost > 0 ? (
                <Alert tone="warning" title={t('discounts.belowCostTitle', { count: belowCost })}>
                  <Checkbox
                    label={t('discounts.belowCostOk')}
                    checked={belowCostOk}
                    onChange={(e) => setBelowCostOk(e.target.checked)}
                  />
                </Alert>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-fg-muted">{t('common.loading')}</p>
          )}
        </section>
      </div>
    </Dialog>
  );
}
