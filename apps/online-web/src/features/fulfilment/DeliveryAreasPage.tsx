import type { OnlineDeliveryArea, SaveOnlineDeliveryArea } from '@arabat/contracts';
import { formatMoney } from '@arabat/i18n';
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
import { useBranches, useSession } from '../../app/context.js';
import { key } from '../shared.js';
import { SortableList, SortableRow } from '../sortable.js';
import { KUWAIT_GOVERNORATES } from './kuwait-areas.js';

/**
 * Delivery areas (ADR-0123): each with its fee, minimum, free-delivery threshold, estimated
 * time and serving branch. Shoppers pick one at checkout; without any, the flat store fee
 * applies.
 */
export function DeliveryAreasPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  if (!can('online.manage')) return <AccessDenied />;
  return (
    <div>
      <PageHeader title={t('nav.areas')} description={t('areas.hint')} />
      <AreaList />
    </div>
  );
}

function AreaList() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const branchName = (id: string | null) => {
    const b = branches.find((x) => x.id === id);
    return b ? localizedName(b, i18n.language) : t('areas.defaultBranch');
  };
  const branches = useBranches();
  const [editing, setEditing] = useState<OnlineDeliveryArea | 'new' | null>(null);
  const [deleting, setDeleting] = useState<OnlineDeliveryArea | null>(null);
  const areas = useQuery({
    queryKey: [...key, 'delivery-areas'],
    queryFn: () => api.online.deliveryAreas(),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const order = useMutation({
    mutationFn: (ids: string[]) => api.online.orderDeliveryAreas(ids),
    onSuccess: refresh,
    onError: async (error) => {
      await refresh();
      notify.fail(error);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.online.deleteDeliveryArea(id),
    onSuccess: async () => {
      setDeleting(null);
      await refresh();
      notify.ok(t('areas.deleted'));
    },
    onError: notify.fail,
  });
  if (areas.isPending) return null;
  if (areas.isError) return <ErrorState error={areas.error} onRetry={() => void areas.refetch()} />;
  const list = areas.data.areas;
  const ids = list.map((a) => a.id);
  const money = (m: { amount: string; currency: string }) =>
    formatMoney(Money.fromJSON(m as { amount: string; currency: 'KWD' }), i18n.language);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={() => setEditing('new')}>{t('areas.add')}</Button>
      </div>
      {list.length === 0 ? (
        <EmptyState title={t('areas.none')} description={t('areas.noneHint')} />
      ) : (
        <Section title={t('areas.listTitle')} description={t('products.dragHint')}>
          <SortableList ids={ids} onOrder={(next) => order.mutate(next)}>
            {list.map((a, index) => (
              <SortableRow
                key={a.id}
                id={a.id}
                label={localizedName(a, i18n.language)}
                first={index === 0}
                last={index === list.length - 1}
                onMove={(by) => {
                  const next = [...ids];
                  next.splice(index, 1);
                  next.splice(index + by, 0, a.id);
                  order.mutate(next);
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{localizedName(a, i18n.language)}</span>
                    {!a.active ? <Badge>{t('areas.inactive')}</Badge> : null}
                  </span>
                  <span className="block text-xs text-fg-muted">
                    {[
                      t('areas.feeShort', { fee: money(a.fee) }),
                      Money.fromJSON(a.minimumOrder as { amount: string; currency: 'KWD' }).isZero()
                        ? null
                        : t('areas.minShort', { min: money(a.minimumOrder) }),
                      a.freeDeliveryFrom
                        ? t('areas.freeShort', { from: money(a.freeDeliveryFrom) })
                        : null,
                      a.estimatedMinutes
                        ? t('areas.minutesShort', { count: a.estimatedMinutes })
                        : null,
                      branchName(a.branchId),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
                  {t('products.edit')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(a)}>
                  {t('categories.delete')}
                </Button>
              </SortableRow>
            ))}
          </SortableList>
        </Section>
      )}
      {editing ? (
        <AreaDialog
          area={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await refresh();
            setEditing(null);
          }}
        />
      ) : null}
      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => (!open ? setDeleting(null) : undefined)}
        size="sm"
        title={t('areas.deleteTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting.id)}
            >
              {t('categories.delete')}
            </Button>
          </>
        }
      >
        {deleting ? (
          <p className="text-sm">
            {t('areas.deleteHint', { name: localizedName(deleting, i18n.language) })}
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}

function AreaDialog({
  area,
  onClose,
  onSaved,
}: {
  area: OnlineDeliveryArea | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const branches = useBranches();
  const [v, setV] = useState<SaveOnlineDeliveryArea>({
    nameEn: area?.nameEn ?? null,
    nameAr: area?.nameAr ?? null,
    fee: area?.fee.amount ?? '0.000',
    minimumOrder: area?.minimumOrder.amount ?? '0.000',
    freeDeliveryFrom: area?.freeDeliveryFrom?.amount ?? null,
    estimatedMinutes: area?.estimatedMinutes ?? null,
    branchId: area?.branchId ?? null,
    active: area?.active ?? true,
  });
  const set = (patch: Partial<SaveOnlineDeliveryArea>) => setV((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: () =>
      area
        ? api.online.updateDeliveryArea(area.id, { ...v, version: area.version })
        : api.online.createDeliveryArea(v),
    onSuccess: async () => {
      notify.ok(t('common.saved'));
      await onSaved();
    },
    onError: notify.fail,
  });
  const ar = i18n.language.startsWith('ar');
  return (
    <Dialog
      open
      onOpenChange={(open) => (!open ? onClose() : undefined)}
      title={area ? t('areas.editTitle') : t('areas.add')}
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
        <Field label={t('areas.pickKuwait')} className="sm:col-span-2">
          {(p) => (
            <Select
              {...p}
              value=""
              onChange={(e) => {
                const [en, arName] = e.target.value.split('|');
                if (en) set({ nameEn: en, nameAr: arName ?? null });
              }}
            >
              <option value="">—</option>
              {KUWAIT_GOVERNORATES.map((g) => (
                <optgroup key={g.nameEn} label={ar ? g.nameAr : g.nameEn}>
                  {g.areas.map(([en, arName]) => (
                    <option key={en} value={`${en}|${arName}`}>
                      {ar ? arName : en}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          )}
        </Field>
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
        <Field label={t('areas.fee')}>
          {(p) => (
            <Input {...p} dir="ltr" value={v.fee} onChange={(e) => set({ fee: e.target.value })} />
          )}
        </Field>
        <Field label={t('areas.minimum')} hint={t('areas.minimumHint')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              value={v.minimumOrder ?? '0.000'}
              onChange={(e) => set({ minimumOrder: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('areas.freeFrom')} hint={t('areas.freeFromHint')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              value={v.freeDeliveryFrom ?? ''}
              onChange={(e) => set({ freeDeliveryFrom: e.target.value || null })}
            />
          )}
        </Field>
        <Field label={t('areas.minutes')} hint={t('areas.minutesHint')}>
          {(p) => (
            <Input
              {...p}
              type="number"
              min={1}
              max={1440}
              dir="ltr"
              value={v.estimatedMinutes ?? ''}
              onChange={(e) =>
                set({ estimatedMinutes: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          )}
        </Field>
        <Field label={t('areas.branch')} hint={t('areas.branchHint')}>
          {(p) => (
            <Select
              {...p}
              value={v.branchId ?? ''}
              onChange={(e) => set({ branchId: e.target.value || null })}
            >
              <option value="">{t('areas.defaultBranch')}</option>
              {branches
                .filter((b) => b.status === 'active')
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {localizedName(b, i18n.language)}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Checkbox
          label={t('areas.active')}
          checked={v.active ?? true}
          onChange={(e) => set({ active: e.target.checked })}
        />
      </div>
    </Dialog>
  );
}
