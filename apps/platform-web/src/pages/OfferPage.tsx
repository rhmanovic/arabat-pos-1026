import type { OfferItem, OfferItemIcon, SaveOfferItem } from '@arabat/contracts';
import { OFFER_ITEM_ICONS } from '@arabat/contracts';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
} from '@arabat/ui';
import { ErrorState, useApi, useErrorMessage, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { platformKey, useFormat, useRole } from '../shared.js';

/** What the public pricing page sells: the yearly system and the devices (ADR-0114). */
export function OfferPage() {
  const { t } = useTranslation();
  const api = useApi();
  const f = useFormat();
  const { can } = useRole();
  const editable = can('platform.super_admin', 'platform.billing');
  const [editing, setEditing] = useState<OfferItem | 'new' | null>(null);
  const items = useQuery({
    queryKey: [...platformKey, 'offer-items'],
    queryFn: () => api.platform.offerItems(),
  });
  return (
    <div>
      <PageHeader
        title={t('offer.title')}
        description={t('offer.subtitle')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => window.open('/pricing', '_blank')}>
              {t('offer.openPage')}
            </Button>
            {editable ? (
              <Button onClick={() => setEditing('new')}>{t('offer.newDevice')}</Button>
            ) : null}
          </div>
        }
      />
      <DataTable
        caption={t('offer.title')}
        loading={items.isPending}
        error={
          items.isError ? (
            <ErrorState error={items.error} onRetry={() => void items.refetch()} />
          ) : null
        }
        rows={items.data?.items}
        rowKey={(i) => i.id}
        {...(editable ? { onRowClick: (i: OfferItem) => setEditing(i) } : {})}
        columns={[
          {
            key: 'image',
            header: '',
            cell: (i) =>
              i.imageUrl ? (
                <img src={i.imageUrl} alt="" className="size-10 rounded-sm object-cover" />
              ) : (
                <span className="grid size-10 place-items-center rounded-sm bg-surface-muted text-xs text-fg-muted">
                  {t(`offer.icons.${i.icon}`).slice(0, 2)}
                </span>
              ),
          },
          {
            key: 'name',
            header: t('offer.name'),
            cell: (i) => (
              <span className="flex flex-wrap items-center gap-1">
                <span className="font-medium">{f.planName(i)}</span>
                {i.kind === 'system' ? <Badge tone="primary">{t('offer.system')}</Badge> : null}
                {i.status === 'hidden' ? <Badge>{t('offer.hidden')}</Badge> : null}
              </span>
            ),
          },
          {
            key: 'price',
            header: t('offer.price'),
            cell: (i) => (
              <span dir="ltr" className="tabular-nums">
                {t(i.kind === 'system' ? 'offer.perYear' : 'offer.once', {
                  price: `${i.price.amount} ${i.price.currency}`,
                })}
              </span>
            ),
          },
          {
            key: 'max',
            header: t('offer.maxQuantity'),
            hideBelow: 'md',
            cell: (i) => (i.kind === 'system' ? '—' : i.maxQuantity),
          },
          { key: 'order', header: t('offer.sortOrder'), hideBelow: 'md', cell: (i) => i.sortOrder },
        ]}
      />
      {editing ? (
        <OfferItemDialog
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function OfferItemDialog({ item, onClose }: { item: OfferItem | null; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState(item);
  const system = current?.kind === 'system';
  const [v, setV] = useState({
    nameAr: item?.nameAr ?? '',
    nameEn: item?.nameEn ?? '',
    descriptionAr: item?.descriptionAr ?? '',
    descriptionEn: item?.descriptionEn ?? '',
    price: item?.price.amount ?? '',
    icon: (item?.icon ?? 'other') as OfferItemIcon,
    maxQuantity: String(item?.maxQuantity ?? 10),
    status: item?.status ?? 'active',
    sortOrder: String(item?.sortOrder ?? 100),
  });
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: [...platformKey, 'offer-items'] });
  const save = useMutation({
    mutationFn: () => {
      const body: SaveOfferItem = {
        nameAr: v.nameAr,
        nameEn: v.nameEn,
        descriptionAr: v.descriptionAr,
        descriptionEn: v.descriptionEn,
        price: v.price,
        icon: v.icon,
        maxQuantity: Number(v.maxQuantity),
        status: v.status,
        sortOrder: Number(v.sortOrder),
        version: current?.version ?? 0,
      };
      return api.platform.saveOfferItem(current?.id ?? null, body);
    },
    onSuccess: async () => {
      await refresh();
      notify.ok(t('offer.saved'));
      onClose();
    },
  });
  const image = useMutation({
    mutationFn: (file: File | null) =>
      file
        ? api.platform.uploadOfferImage(current!.id, file)
        : api.platform.removeOfferImage(current!.id),
    onSuccess: async (updated) => {
      setCurrent(updated);
      await refresh();
    },
  });
  const text = (
    key:
      | 'nameAr'
      | 'nameEn'
      | 'descriptionAr'
      | 'descriptionEn'
      | 'price'
      | 'sortOrder'
      | 'maxQuantity',
    label: string,
    dir?: 'ltr',
    hint?: string,
  ) => (
    <Field label={label} {...(hint ? { hint } : {})}>
      {(p) => (
        <Input
          {...p}
          {...(dir ? { dir } : {})}
          value={v[key]}
          onChange={(e) => set({ [key]: e.target.value })}
        />
      )}
    </Field>
  );
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={current ? t('offer.edit') : t('offer.newDevice')}
      footer={
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          {t('offer.save')}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {text('nameAr', t('offer.nameAr'))}
        {text('nameEn', t('offer.nameEn'), 'ltr')}
        {text('descriptionAr', t('offer.descriptionAr'))}
        {text('descriptionEn', t('offer.descriptionEn'), 'ltr')}
        {text(
          'price',
          system ? t('offer.priceYear') : t('offer.priceOnce'),
          'ltr',
          t('offer.priceHint'),
        )}
        {system ? null : text('maxQuantity', t('offer.maxQuantity'), 'ltr')}
        <Field label={t('offer.icon')} hint={t('offer.iconHint')}>
          {(p) => (
            <Select
              {...p}
              value={v.icon}
              onChange={(e) => set({ icon: e.target.value as OfferItemIcon })}
            >
              {OFFER_ITEM_ICONS.map((icon) => (
                <option key={icon} value={icon}>
                  {t(`offer.icons.${icon}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {system ? null : (
          <Field label={t('offer.status')}>
            {(p) => (
              <Select
                {...p}
                value={v.status}
                onChange={(e) => set({ status: e.target.value as 'active' | 'hidden' })}
              >
                <option value="active">{t('offer.statusActive')}</option>
                <option value="hidden">{t('offer.statusHidden')}</option>
              </Select>
            )}
          </Field>
        )}
        {text('sortOrder', t('offer.sortOrder'), 'ltr')}

        <div className="flex flex-col gap-2 sm:col-span-2">
          <span className="text-sm font-medium">{t('offer.image')}</span>
          {current ? (
            <div className="flex flex-wrap items-center gap-3">
              {current.imageUrl ? (
                <img
                  src={current.imageUrl}
                  alt=""
                  className="size-20 rounded-md border border-border object-cover"
                />
              ) : (
                <span className="text-sm text-fg-muted">{t('offer.noImage')}</span>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) image.mutate(file);
                  e.target.value = '';
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                loading={image.isPending}
                onClick={() => fileInput.current?.click()}
              >
                {current.imageUrl ? t('offer.replaceImage') : t('offer.uploadImage')}
              </Button>
              {current.imageUrl ? (
                <Button variant="ghost" size="sm" onClick={() => image.mutate(null)}>
                  {t('offer.removeImage')}
                </Button>
              ) : null}
            </div>
          ) : (
            <span className="text-sm text-fg-muted">{t('offer.imageAfterSave')}</span>
          )}
          {image.isError ? <Alert tone="danger">{message(image.error)}</Alert> : null}
        </div>

        {save.isError ? (
          <Alert tone="danger" className="sm:col-span-2">
            {message(save.error)}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
