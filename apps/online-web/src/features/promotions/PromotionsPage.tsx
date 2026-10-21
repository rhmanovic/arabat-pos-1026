import type { OnlinePromotion, SaveOnlinePromotion } from '@arabat/contracts';
import { formatDateTime, formatMoney } from '@arabat/i18n';
import { Money } from '@arabat/money';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Section,
  Select,
} from '@arabat/ui';
import { AccessDenied, ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../app/context.js';
import { key } from '../shared.js';

/**
 * Promotions (ADR-0125): discount codes and automatic offers. One applies per order; a used
 * promotion is paused, never deleted.
 */
export function PromotionsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  if (!can('online.manage')) return <AccessDenied />;
  return (
    <div>
      <PageHeader title={t('nav.promotions')} description={t('promotions.hint')} />
      <PromotionList />
    </div>
  );
}

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

function PromotionList() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<OnlinePromotion | 'new' | null>(null);
  const promotions = useQuery({
    queryKey: [...key, 'promotions'],
    queryFn: () => api.online.promotions(),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const remove = useMutation({
    mutationFn: (id: string) => api.online.deletePromotion(id),
    onSuccess: async () => {
      await refresh();
      notify.ok(t('promotions.removed'));
    },
    onError: notify.fail,
  });
  if (promotions.isPending) return null;
  if (promotions.isError)
    return <ErrorState error={promotions.error} onRetry={() => void promotions.refetch()} />;
  const list = promotions.data.promotions;
  const money = (m: { amount: string; currency: string }) =>
    formatMoney(Money.fromJSON(m as { amount: string; currency: 'KWD' }), i18n.language);
  const describe = (p: OnlinePromotion) =>
    p.discountType === 'percentage'
      ? t('promotions.percentOff', { percent: p.percent })
      : p.discountType === 'fixed'
        ? t('promotions.amountOff', { amount: money(p.amount!) })
        : t('promotions.freeDelivery');
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={() => setEditing('new')}>{t('promotions.add')}</Button>
      </div>
      {list.length === 0 ? (
        <EmptyState title={t('promotions.none')} description={t('promotions.noneHint')} />
      ) : (
        <Section title={t('promotions.listTitle')}>
          <ul className="flex flex-col gap-2">
            {list.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3"
                data-testid="promotion"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{localizedName(p, i18n.language)}</span>
                    {p.code ? (
                      <Badge tone="primary">
                        <span dir="ltr">{p.code}</span>
                      </Badge>
                    ) : (
                      <Badge>{t('promotions.automatic')}</Badge>
                    )}
                    {p.status === 'paused' ? (
                      <Badge tone="warning">{t('promotions.paused')}</Badge>
                    ) : null}
                  </span>
                  <span className="block text-xs text-fg-muted">
                    {[
                      describe(p),
                      p.appliesTo === 'order' ? null : t(`promotions.appliesTo_${p.appliesTo}`),
                      Money.fromJSON(p.minimumOrder as { amount: string; currency: 'KWD' }).isZero()
                        ? null
                        : t('promotions.minShort', { min: money(p.minimumOrder) }),
                      t('promotions.usesShort', { count: p.usesCount, max: p.maxUses ?? '∞' }),
                      p.endsAt
                        ? t('promotions.until', { time: formatDateTime(p.endsAt, i18n.language) })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                  {t('products.edit')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={remove.isPending && remove.variables === p.id}
                  onClick={() => remove.mutate(p.id)}
                >
                  {p.usesCount > 0 ? t('promotions.pause') : t('categories.delete')}
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {editing ? (
        <PromotionDialog
          promotion={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await refresh();
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function PromotionDialog({
  promotion,
  onClose,
  onSaved,
}: {
  promotion: OnlinePromotion | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const categories = useQuery({
    queryKey: [...key, 'categories'],
    queryFn: () => api.online.categories(),
  });
  const listings = useQuery({
    queryKey: [...key, 'listings'],
    queryFn: () => api.online.listings(),
  });
  const collections = useQuery({
    queryKey: [...key, 'collections'],
    queryFn: () => api.online.collections(),
  });
  const [v, setV] = useState<SaveOnlinePromotion>({
    nameEn: promotion?.nameEn ?? null,
    nameAr: promotion?.nameAr ?? null,
    kind: promotion?.kind ?? 'code',
    code: promotion?.code ?? null,
    discountType: promotion?.discountType ?? 'percentage',
    percent: promotion?.percent ?? null,
    amount: promotion?.amount?.amount ?? null,
    minimumOrder: promotion?.minimumOrder.amount ?? '0.000',
    maxUses: promotion?.maxUses ?? null,
    maxUsesPerCustomer: promotion?.maxUsesPerCustomer ?? null,
    startsAt: promotion?.startsAt ?? null,
    endsAt: promotion?.endsAt ?? null,
    status: promotion?.status ?? 'active',
    appliesTo: promotion?.appliesTo ?? 'order',
    targetIds: promotion?.targetIds ?? [],
  });
  const set = (patch: Partial<SaveOnlinePromotion>) => setV((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: () =>
      promotion
        ? api.online.updatePromotion(promotion.id, { ...v, version: promotion.version })
        : api.online.createPromotion(v),
    onSuccess: async () => {
      notify.ok(t('common.saved'));
      await onSaved();
    },
    onError: notify.fail,
  });
  const targets =
    v.appliesTo === 'category'
      ? [
          ...(categories.data?.categories ?? []).map((c) => ({
            id: c.id,
            label: localizedName(c, i18n.language),
          })),
          // Collections (ADR-0130) are targeted like categories; former store categories are
          // collections with the same ids, so existing promotions keep their targets.
          ...(collections.data?.collections ?? []).map((c) => ({
            id: c.id,
            label: t('promotions.collectionTarget', { name: localizedName(c, i18n.language) }),
          })),
        ]
      : v.appliesTo === 'product'
        ? (listings.data?.products ?? [])
            .filter((p) => p.visible)
            .map((p) => ({ id: p.productId, label: localizedName(p, i18n.language) }))
        : [];
  const toggleTarget = (id: string, on: boolean) =>
    set({
      targetIds: on ? [...(v.targetIds ?? []), id] : (v.targetIds ?? []).filter((x) => x !== id),
    });
  return (
    <Dialog
      open
      onOpenChange={(open) => (!open ? onClose() : undefined)}
      size="lg"
      title={promotion ? t('promotions.editTitle') : t('promotions.add')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('categories.nameAr')}>
          {(p) => (
            <Input
              {...p}
              value={v.nameAr ?? ''}
              onChange={(e) => set({ nameAr: e.target.value || null })}
            />
          )}
        </Field>
        <Field label={t('categories.nameEn')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              value={v.nameEn ?? ''}
              onChange={(e) => set({ nameEn: e.target.value || null })}
            />
          )}
        </Field>
        <Field label={t('promotions.kind')}>
          {(p) => (
            <Select
              {...p}
              value={v.kind ?? 'code'}
              onChange={(e) => set({ kind: e.target.value as 'code' | 'automatic' })}
            >
              <option value="code">{t('promotions.kind_code')}</option>
              <option value="automatic">{t('promotions.kind_automatic')}</option>
            </Select>
          )}
        </Field>
        {v.kind === 'code' ? (
          <Field label={t('promotions.code')} hint={t('promotions.codeHint')}>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                autoComplete="off"
                value={v.code ?? ''}
                onChange={(e) => set({ code: e.target.value.toUpperCase() || null })}
              />
            )}
          </Field>
        ) : (
          <div />
        )}
        <Field label={t('promotions.type')}>
          {(p) => (
            <Select
              {...p}
              value={v.discountType}
              onChange={(e) =>
                set({ discountType: e.target.value as 'percentage' | 'fixed' | 'free_delivery' })
              }
            >
              <option value="percentage">{t('promotions.type_percentage')}</option>
              <option value="fixed">{t('promotions.type_fixed')}</option>
              <option value="free_delivery">{t('promotions.type_free_delivery')}</option>
            </Select>
          )}
        </Field>
        {v.discountType === 'percentage' ? (
          <Field label={t('promotions.percent')}>
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
        ) : v.discountType === 'fixed' ? (
          <Field label={t('promotions.amount')}>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                inputMode="decimal"
                value={v.amount ?? ''}
                onChange={(e) => set({ amount: e.target.value || null })}
              />
            )}
          </Field>
        ) : (
          <div />
        )}
        <Field label={t('areas.minimum')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              inputMode="decimal"
              value={v.minimumOrder ?? '0.000'}
              onChange={(e) => set({ minimumOrder: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('promotions.maxUses')} hint={t('promotions.unlimitedHint')}>
          {(p) => (
            <Input
              {...p}
              type="number"
              min={1}
              dir="ltr"
              value={v.maxUses ?? ''}
              onChange={(e) =>
                set({ maxUses: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          )}
        </Field>
        <Field label={t('promotions.maxUsesPerCustomer')} hint={t('promotions.unlimitedHint')}>
          {(p) => (
            <Input
              {...p}
              type="number"
              min={1}
              dir="ltr"
              value={v.maxUsesPerCustomer ?? ''}
              onChange={(e) =>
                set({ maxUsesPerCustomer: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          )}
        </Field>
        <Field label={t('promotions.startsAt')}>
          {(p) => (
            <Input
              {...p}
              type="datetime-local"
              dir="ltr"
              value={toLocalInput(v.startsAt ?? null)}
              onChange={(e) => set({ startsAt: fromLocalInput(e.target.value) })}
            />
          )}
        </Field>
        <Field label={t('promotions.endsAt')}>
          {(p) => (
            <Input
              {...p}
              type="datetime-local"
              dir="ltr"
              value={toLocalInput(v.endsAt ?? null)}
              onChange={(e) => set({ endsAt: fromLocalInput(e.target.value) })}
            />
          )}
        </Field>
        <Field label={t('promotions.appliesTo')}>
          {(p) => (
            <Select
              {...p}
              value={v.appliesTo ?? 'order'}
              onChange={(e) =>
                set({
                  appliesTo: e.target.value as 'order' | 'category' | 'product',
                  targetIds: [],
                })
              }
            >
              <option value="order">{t('promotions.appliesTo_order')}</option>
              <option value="category">{t('promotions.appliesTo_category')}</option>
              <option value="product">{t('promotions.appliesTo_product')}</option>
            </Select>
          )}
        </Field>
        <Field label={t('categories.status')}>
          {(p) => (
            <Select
              {...p}
              value={v.status ?? 'active'}
              onChange={(e) => set({ status: e.target.value as 'active' | 'paused' })}
            >
              <option value="active">{t('promotions.active')}</option>
              <option value="paused">{t('promotions.paused')}</option>
            </Select>
          )}
        </Field>
        {targets.length > 0 ? (
          <div className="sm:col-span-2">
            <p className="mb-1 text-sm font-medium">{t('promotions.targets')}</p>
            <div className="grid max-h-48 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
              {targets.map((x) => (
                <Checkbox
                  key={x.id}
                  label={x.label}
                  checked={(v.targetIds ?? []).includes(x.id)}
                  onChange={(e) => toggleTarget(x.id, e.target.checked)}
                />
              ))}
            </div>
          </div>
        ) : v.appliesTo !== 'order' ? (
          <p className="text-sm text-fg-muted sm:col-span-2">{t('promotions.noTargets')}</p>
        ) : null}
      </div>
    </Dialog>
  );
}
