import type {
  LinkItem,
  LinkItemKind,
  LinkPage,
  SaveLinkItem,
  SaveLinkPage,
} from '@arabat/contracts';
import {
  LINK_BACKGROUNDS,
  LINK_BUTTON_STYLES,
  LINK_ITEM_KINDS,
  isAllowedLinkUrl,
} from '@arabat/contracts';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Input,
  Section,
  Select,
  Textarea,
} from '@arabat/ui';
import { ErrorState, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const key = ['manager', 'online', 'link-page'] as const;

/** Address hint per kind: the merchant pastes a full address (BR-200). */
export const URL_PLACEHOLDER: Record<LinkItemKind, string> = {
  link: 'https://',
  website: 'https://example.com',
  store: 'https://',
  instagram: 'https://instagram.com/yourshop',
  tiktok: 'https://tiktok.com/@yourshop',
  snapchat: 'https://snapchat.com/add/yourshop',
  x: 'https://x.com/yourshop',
  facebook: 'https://facebook.com/yourshop',
  youtube: 'https://youtube.com/@yourshop',
  whatsapp: 'https://wa.me/96512345678',
  telegram: 'https://t.me/yourshop',
  email: 'mailto:hello@example.com',
  phone: 'tel:+96512345678',
  location: 'https://maps.google.com/?q=',
};

/**
 * Turns what people usually type into a full address: a bare domain gets https://,
 * an e-mail address mailto:, a phone number tel: (or wa.me for WhatsApp).
 */
export function normalizeLinkUrl(kind: LinkItemKind, raw: string): string {
  const value = raw.trim();
  if (!value || isAllowedLinkUrl(value)) return value;
  const digits = value.replace(/[\s()-]/g, '');
  if (/^\+?\d{6,15}$/.test(digits)) {
    if (kind === 'whatsapp') return `https://wa.me/${digits.replace(/^\+/, '')}`;
    if (kind === 'phone') return `tel:${digits}`;
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  if (value.startsWith('@')) {
    const handle = value.slice(1);
    const base: Partial<Record<LinkItemKind, string>> = {
      instagram: 'https://instagram.com/',
      tiktok: 'https://tiktok.com/@',
      x: 'https://x.com/',
      telegram: 'https://t.me/',
      snapchat: 'https://snapchat.com/add/',
      youtube: 'https://youtube.com/@',
    };
    if (base[kind]) return `${base[kind]}${handle}`;
  }
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(value)) return `https://${value}`;
  return value;
}

/** Link page ("link in bio", ADR-0116): page design, its links and their order. */
export function LinkPageTab() {
  const api = useApi();
  const page = useQuery({ queryKey: key, queryFn: () => api.linkPage.get() });
  if (page.isError) return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  if (!page.data) return null;
  return (
    <div className="flex flex-col gap-4">
      <LinksSection page={page.data} />
      <DesignForm key={page.data.version} page={page.data} />
    </div>
  );
}

// ------------------------------------------------------------------------------ design
function toForm(p: LinkPage): SaveLinkPage {
  return {
    slug: p.slug,
    status: p.status,
    titleAr: p.titleAr,
    titleEn: p.titleEn,
    bioAr: p.bioAr,
    bioEn: p.bioEn,
    themeColor: p.themeColor,
    buttonStyle: p.buttonStyle,
    background: p.background,
    version: p.version,
  };
}

function DesignForm({ page }: { page: LinkPage }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [v, setV] = useState<SaveLinkPage>(() => toForm(page));
  const set = (patch: Partial<SaveLinkPage>) => setV((x) => ({ ...x, ...patch }));
  const done = async (saved: LinkPage, message: string) => {
    queryClient.setQueryData(key, saved);
    await queryClient.invalidateQueries({ queryKey: key });
    notify.ok(message);
  };
  const save = useMutation({
    mutationFn: () => api.linkPage.save(v),
    onSuccess: (saved) => done(saved, t('common.saved')),
    onError: notify.fail,
  });
  const upload = useMutation({
    mutationFn: (file: File) => api.linkPage.uploadAvatar(file),
    onSuccess: (saved) => done(saved, t('linkPage.avatarSaved')),
    onError: notify.fail,
  });
  const removeAvatar = useMutation({
    mutationFn: () => api.linkPage.removeAvatar(),
    onSuccess: (saved) => done(saved, t('linkPage.avatarRemoved')),
    onError: notify.fail,
  });
  const text = (field: 'titleAr' | 'titleEn' | 'slug', label: string, ltr = false) => (
    <Field label={label}>
      {(p) => (
        <Input
          {...p}
          dir={ltr ? 'ltr' : undefined}
          value={v[field] ?? ''}
          onChange={(e) => set({ [field]: e.target.value })}
        />
      )}
    </Field>
  );
  const published = page.status === 'published';
  return (
    <>
      <Section title={t('linkPage.addressSection')} description={t('linkPage.addressHint')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('linkPage.status')}>
            {(p) => (
              <Select
                {...p}
                value={v.status}
                onChange={(e) => set({ status: e.target.value as SaveLinkPage['status'] })}
              >
                <option value="draft">{t('linkPage.status_draft')}</option>
                <option value="published">{t('linkPage.status_published')}</option>
              </Select>
            )}
          </Field>
          {text('slug', t('linkPage.slug'), true)}
          <div className="flex flex-wrap items-center gap-2 text-sm sm:col-span-2">
            <span>{t('linkPage.url')}:</span>
            {published ? (
              <a
                className="text-primary hover:underline"
                href={page.url}
                target="_blank"
                rel="noreferrer"
                dir="ltr"
              >
                {page.url}
              </a>
            ) : (
              <span dir="ltr">{page.url}</span>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(page.url)
                  .then(() => notify.ok(t('linkPage.copied')))
                  .catch(() => undefined)
              }
            >
              {t('linkPage.copy')}
            </Button>
            {!published ? <Badge tone="warning">{t('linkPage.notPublished')}</Badge> : null}
          </div>
        </div>
      </Section>
      <Section title={t('linkPage.designSection')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center gap-4 sm:col-span-2">
            {page.avatarUrl ? (
              <img
                src={page.avatarUrl}
                alt=""
                className="size-20 rounded-full border border-border object-cover"
              />
            ) : (
              <div className="flex size-20 items-center justify-center rounded-full border border-dashed border-border text-xs text-fg-muted">
                {t('linkPage.noAvatar')}
              </div>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label={t('linkPage.uploadAvatar')}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = '';
              }}
            />
            <Button
              variant="secondary"
              loading={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              {t('linkPage.uploadAvatar')}
            </Button>
            {page.avatarUrl ? (
              <Button
                variant="ghost"
                loading={removeAvatar.isPending}
                onClick={() => removeAvatar.mutate()}
              >
                {t('linkPage.removeAvatar')}
              </Button>
            ) : null}
          </div>
          {text('titleAr', t('linkPage.titleAr'))}
          {text('titleEn', t('linkPage.titleEn'), true)}
          <Field label={t('linkPage.bioAr')}>
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                value={v.bioAr ?? ''}
                onChange={(e) => set({ bioAr: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('linkPage.bioEn')}>
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                dir="ltr"
                value={v.bioEn ?? ''}
                onChange={(e) => set({ bioEn: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('linkPage.color')}>
            {(p) => (
              <Input
                {...p}
                type="color"
                className="h-10 w-20 p-1"
                value={v.themeColor}
                onChange={(e) => set({ themeColor: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('linkPage.buttonStyle')}>
            {(p) => (
              <Select
                {...p}
                value={v.buttonStyle}
                onChange={(e) =>
                  set({ buttonStyle: e.target.value as SaveLinkPage['buttonStyle'] })
                }
              >
                {LINK_BUTTON_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {t(`linkPage.button_${s}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('linkPage.background')}>
            {(p) => (
              <Select
                {...p}
                value={v.background}
                onChange={(e) => set({ background: e.target.value as SaveLinkPage['background'] })}
              >
                {LINK_BACKGROUNDS.map((s) => (
                  <option key={s} value={s}>
                    {t(`linkPage.background_${s}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Section>
      <div>
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          {t('common.save')}
        </Button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------- links
function LinksSection({ page }: { page: LinkPage }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<LinkItem | 'new' | null>(null);
  const [deleting, setDeleting] = useState<LinkItem | null>(null);
  const done = async (saved: LinkPage) => {
    queryClient.setQueryData(key, saved);
    await queryClient.invalidateQueries({ queryKey: key });
  };
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.linkPage.reorder(ids),
    onSuccess: done,
    onError: notify.fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.linkPage.deleteItem(id),
    onSuccess: async (saved) => {
      setDeleting(null);
      await done(saved);
      notify.ok(t('linkPage.deleted'));
    },
    onError: notify.fail,
  });
  const move = (index: number, by: -1 | 1) => {
    const ids = page.items.map((i) => i.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved!);
    reorder.mutate(ids);
  };
  const ar = i18n.language.startsWith('ar');
  const label = (i: LinkItem) => (ar ? i.labelAr || i.labelEn : i.labelEn || i.labelAr) ?? '';
  return (
    <Section
      title={t('linkPage.linksSection')}
      description={t('linkPage.linksHint')}
      actions={<Button onClick={() => setEditing('new')}>{t('linkPage.add')}</Button>}
    >
      {page.items.length === 0 ? (
        <EmptyState title={t('linkPage.noLinks')} description={t('linkPage.noLinksHint')} />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {page.items.map((item, index) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 py-2">
              <div className="flex flex-col">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('linkPage.moveUp', { name: label(item) })}
                  disabled={index === 0 || reorder.isPending}
                  onClick={() => move(index, -1)}
                >
                  ▲
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('linkPage.moveDown', { name: label(item) })}
                  disabled={index === page.items.length - 1 || reorder.isPending}
                  onClick={() => move(index, 1)}
                >
                  ▼
                </Button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {label(item)}
                  <Badge tone="neutral">{t(`linkPage.kind_${item.kind}`)}</Badge>
                  {item.status === 'hidden' ? (
                    <Badge tone="warning">{t('linkPage.hidden')}</Badge>
                  ) : null}
                </p>
                <p className="truncate text-sm text-fg-muted" dir="ltr">
                  {item.url}
                </p>
              </div>
              <span className="text-sm text-fg-muted">
                {t('linkPage.clicks', { count: item.clicks })}
              </span>
              <Button size="sm" variant="secondary" onClick={() => setEditing(item)}>
                {t('common.edit')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleting(item)}>
                {t('common.delete')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <ItemDialog
          item={editing === 'new' ? null : editing}
          storeUrl={page.storeUrl}
          onClose={() => setEditing(null)}
          onSaved={done}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => (!o ? setDeleting(null) : undefined)}
        title={t('linkPage.deleteTitle')}
        description={deleting ? label(deleting) : undefined}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Section>
  );
}

function ItemDialog({
  item,
  storeUrl,
  onClose,
  onSaved,
}: {
  item: LinkItem | null;
  storeUrl: string | null;
  onClose: () => void;
  onSaved: (page: LinkPage) => Promise<void>;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const [v, setV] = useState<SaveLinkItem>(() =>
    item
      ? {
          kind: item.kind,
          labelAr: item.labelAr,
          labelEn: item.labelEn,
          url: item.url,
          status: item.status,
          version: item.version,
        }
      : { kind: 'instagram', labelAr: '', labelEn: '', url: '', status: 'active', version: 0 },
  );
  const set = (patch: Partial<SaveLinkItem>) => setV((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: () =>
      api.linkPage.saveItem(item?.id ?? null, { ...v, url: normalizeLinkUrl(v.kind, v.url) }),
    onSuccess: async (saved) => {
      await onSaved(saved);
      notify.ok(t('common.saved'));
      onClose();
    },
    onError: notify.fail,
  });
  const changeKind = (kind: LinkItemKind) => {
    const patch: Partial<SaveLinkItem> = { kind };
    // Suggest a label (and the store's address) while the fields are still empty.
    if (!v.labelAr) patch.labelAr = t(`linkPage.kind_${kind}`, { lng: 'ar' });
    if (!v.labelEn) patch.labelEn = t(`linkPage.kind_${kind}`, { lng: 'en' });
    if (kind === 'store' && storeUrl && !v.url) patch.url = storeUrl;
    set(patch);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={item ? t('linkPage.editLink') : t('linkPage.add')}
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
      <div className="grid gap-4">
        <Field label={t('linkPage.kind')}>
          {(p) => (
            <Select
              {...p}
              value={v.kind}
              onChange={(e) => changeKind(e.target.value as LinkItemKind)}
            >
              {LINK_ITEM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`linkPage.kind_${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('linkPage.linkUrl')} hint={t('linkPage.linkUrlHint')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              placeholder={URL_PLACEHOLDER[v.kind]}
              value={v.url}
              onChange={(e) => set({ url: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('linkPage.labelAr')}>
          {(p) => (
            <Input
              {...p}
              value={v.labelAr ?? ''}
              onChange={(e) => set({ labelAr: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('linkPage.labelEn')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              value={v.labelEn ?? ''}
              onChange={(e) => set({ labelEn: e.target.value })}
            />
          )}
        </Field>
        <Checkbox
          label={t('linkPage.showLink')}
          checked={v.status === 'active'}
          onChange={(e) => set({ status: e.target.checked ? 'active' : 'hidden' })}
        />
      </div>
    </Dialog>
  );
}
