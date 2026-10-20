import type {
  DesignLink,
  Localized,
  StoreAsset,
  StoreDesign,
  StoreProduct,
  Storefront,
} from '@arabat/contracts';
import { Button, Checkbox, Dialog, Field, Input, Select, Textarea, cn } from '@arabat/ui';
import { localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { key } from '../shared.js';

export const designKey = [...key, 'design'] as const;

/** Store categories and products as the storefront sees them (link targets, selections). */
export function useStoreCatalog(): {
  store: Storefront | null;
  products: StoreProduct[];
} {
  const api = useApi();
  const store = useQuery({
    queryKey: [...designKey, 'preview-store'],
    queryFn: () => api.online.previewStorefront(),
    retry: false,
  });
  const products = useQuery({
    queryKey: [...designKey, 'preview-products'],
    queryFn: () => api.online.previewProducts(),
    retry: false,
    enabled: store.isSuccess,
  });
  return { store: store.data ?? null, products: products.data?.products ?? [] };
}

/** A small group of mutually exclusive options shown as chips (radio semantics). */
export function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              o.value === value
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-border bg-surface hover:border-border-strong',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return <Checkbox label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />;
}

/** The same text in Arabic and English. */
export function LocalizedField({
  label,
  value,
  onChange,
  multiline = false,
  max,
}: {
  label: string;
  value: Localized;
  onChange: (value: Localized) => void;
  multiline?: boolean;
  max?: number;
}) {
  const { t } = useTranslation();
  const one = (lang: 'ar' | 'en') => (
    <Field label={`${label} (${t(`design.lang_${lang}`)})`}>
      {(p) =>
        multiline ? (
          <Textarea
            {...p}
            rows={3}
            dir={lang === 'ar' ? 'rtl' : 'ltr'}
            maxLength={max}
            value={value[lang] ?? ''}
            onChange={(e) => onChange({ ...value, [lang]: e.target.value || null })}
          />
        ) : (
          <Input
            {...p}
            dir={lang === 'ar' ? 'rtl' : 'ltr'}
            maxLength={max}
            value={value[lang] ?? ''}
            onChange={(e) => onChange({ ...value, [lang]: e.target.value || null })}
          />
        )
      }
    </Field>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {one('ar')}
      {one('en')}
    </div>
  );
}

/** Where a button or menu item goes: a page, a category, a product, an address, or nowhere. */
export function LinkPicker({
  label,
  value,
  onChange,
  optional = true,
}: {
  label: string;
  value: DesignLink | null;
  onChange: (value: DesignLink | null) => void;
  optional?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { store, products } = useStoreCatalog();
  const kind = value?.kind ?? 'none';
  const setKind = (k: string) => {
    if (k === 'none') onChange(null);
    else if (k === 'page') onChange({ kind: 'page', page: 'products' });
    else if (k === 'category')
      onChange({ kind: 'category', categoryId: store?.categories[0]?.id ?? '' });
    else if (k === 'product')
      onChange({ kind: 'product', productId: products[0]?.productId ?? '' });
    else onChange({ kind: 'url', url: 'https://' });
  };
  return (
    <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
      <Field label={label}>
        {(p) => (
          <Select {...p} value={kind} onChange={(e) => setKind(e.target.value)}>
            {optional ? <option value="none">{t('design.link_none')}</option> : null}
            <option value="page">{t('design.link_page')}</option>
            <option value="category">{t('design.link_category')}</option>
            <option value="product">{t('design.link_product')}</option>
            <option value="url">{t('design.link_url')}</option>
          </Select>
        )}
      </Field>
      {value?.kind === 'page' ? (
        <Field label={t('design.link_page')}>
          {(p) => (
            <Select
              {...p}
              value={value.page}
              onChange={(e) =>
                onChange({ kind: 'page', page: e.target.value as typeof value.page })
              }
            >
              {(['home', 'products', 'categories', 'cart', 'account'] as const).map((page) => (
                <option key={page} value={page}>
                  {t(`design.page_${page}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : value?.kind === 'category' ? (
        <Field label={t('design.link_category')}>
          {(p) => (
            <Select
              {...p}
              value={value.categoryId}
              onChange={(e) => onChange({ kind: 'category', categoryId: e.target.value })}
            >
              {(store?.categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {localizedName(c, i18n.language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : value?.kind === 'product' ? (
        <Field label={t('design.link_product')}>
          {(p) => (
            <Select
              {...p}
              value={value.productId}
              onChange={(e) => onChange({ kind: 'product', productId: e.target.value })}
            >
              {products.map((x) => (
                <option key={x.productId} value={x.productId}>
                  {localizedName(x, i18n.language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : value?.kind === 'url' ? (
        <Field label={t('design.link_url')} hint={t('design.urlHint')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              value={value.url}
              onChange={(e) => onChange({ kind: 'url', url: e.target.value })}
            />
          )}
        </Field>
      ) : (
        <div />
      )}
    </div>
  );
}

/** A design picture: upload a new one or pick one already uploaded. */
export function ImagePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [library, setLibrary] = useState(false);
  const upload = useMutation({
    mutationFn: (file: File) => api.online.uploadDesignAsset(file),
    onSuccess: async (asset) => {
      await queryClient.invalidateQueries({ queryKey: [...designKey, 'assets'] });
      onChange(asset.id);
    },
    onError: notify.fail,
  });
  const src = value ? `/api/v1/manager/online/design/assets/${value}/file` : null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-3">
        <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-border-strong bg-surface-muted">
          {src ? (
            <img src={src} alt="" className="size-full object-cover" data-testid="picked-image" />
          ) : (
            <span aria-hidden className="text-2xl text-fg-subtle">
              🖼️
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={upload.isPending} onClick={() => input.current?.click()}>
            {t('design.upload')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setLibrary(true)}>
            {t('design.library')}
          </Button>
          {value ? (
            <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
              {t('design.removeImage')}
            </Button>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          aria-label={t('design.uploadFile', { label })}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = '';
          }}
        />
      </div>
      <p className="text-xs text-fg-muted">{t('design.imageHint')}</p>
      {library ? (
        <AssetLibrary
          onClose={() => setLibrary(false)}
          onPick={(id) => {
            onChange(id);
            setLibrary(false);
          }}
        />
      ) : null}
    </div>
  );
}

function AssetLibrary({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const assets = useQuery({
    queryKey: [...designKey, 'assets'],
    queryFn: () => api.online.designAssets(),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.online.removeDesignAsset(id),
    onSuccess: (r) => queryClient.setQueryData([...designKey, 'assets'], r),
    onError: notify.fail,
  });
  const list: StoreAsset[] = assets.data?.assets ?? [];
  return (
    <Dialog
      open
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={t('design.library')}
      size="lg"
    >
      {list.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('design.libraryEmpty')}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {list.map((a) => (
            <li key={a.id} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => onPick(a.id)}
                className="aspect-square overflow-hidden rounded-lg border border-border hover:border-primary"
                aria-label={t('design.pick')}
              >
                <img src={a.url} alt="" className="size-full object-cover" />
              </button>
              <Button
                size="sm"
                variant="ghost"
                loading={remove.isPending && remove.variables === a.id}
                onClick={() => remove.mutate(a.id)}
              >
                {t('design.deleteImage')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/** A titled group of fields inside an editor panel. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-bold">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Pick several items out of a list (categories, products); none = all. */
export function MultiPick({
  label,
  options,
  value,
  onChange,
  emptyMeansAll = true,
}: {
  label: string;
  options: { id: string; label: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
  emptyMeansAll?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">{label}</p>
      {emptyMeansAll ? <p className="text-xs text-fg-muted">{t('design.noneMeansAll')}</p> : null}
      {options.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('design.nothingToPick')}</p>
      ) : (
        <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
          {options.map((o) => (
            <Checkbox
              key={o.id}
              label={o.label}
              checked={value.includes(o.id)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A collapsible group of the header and footer editors (open by default). */
export function Panel({
  title,
  hint,
  icon,
  children,
}: {
  title: string;
  hint?: string;
  icon: string;
  children: ReactNode;
}) {
  return (
    <details open className="group rounded-xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-lg"
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{title}</span>
          {hint ? <span className="block text-xs text-fg-muted">{hint}</span> : null}
        </span>
        <span aria-hidden className="text-fg-subtle transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-border p-4">{children}</div>
    </details>
  );
}

/** The store's social accounts (handles without @, WhatsApp with the country code). */
export function SocialFields({
  design,
  set,
}: {
  design: StoreDesign;
  set: (next: StoreDesign) => void;
}) {
  const { t } = useTranslation();
  const keys = ['instagram', 'tiktok', 'snapchat', 'x', 'youtube', 'whatsapp'] as const;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {keys.map((k) => (
        <Field key={k} label={t(`design.social_${k}`)}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              placeholder={k === 'whatsapp' ? '+96550000000' : 'username'}
              value={design.social[k]}
              onChange={(e) =>
                set({
                  ...design,
                  social: { ...design.social, [k]: e.target.value.replace(/^@/, '').trim() },
                })
              }
            />
          )}
        </Field>
      ))}
    </div>
  );
}
