import type {
  LinkItem,
  LinkItemKind,
  LinkPage,
  SaveLinkItem,
  SaveLinkPage,
} from '@arabat/contracts';
import {
  LINK_ANIMATIONS,
  LINK_BACKGROUNDS,
  LINK_BUTTON_STYLES,
  LINK_BUTTON_VARIANTS,
  LINK_FONTS,
  LINK_ITEM_EFFECTS,
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
import {
  ErrorState,
  LINK_FONT_FAMILY,
  LinkPageView,
  type LinkPageViewData,
  linkPageTheme,
  loadLinkFont,
  useApi,
  useNotify,
} from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

const key = ['links', 'page'] as const;

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

/** Quick emoji choices for a button (any emoji can also be typed). */
export const EMOJI_CHOICES = [
  '📸',
  '💬',
  '🛍️',
  '🛒',
  '📍',
  '📞',
  '✉️',
  '🌐',
  '☕',
  '🍔',
  '🍰',
  '🎁',
  '🚚',
  '💳',
  '⭐',
  '🔥',
  '❤️',
  '🎉',
  '🕒',
  '📅',
] as const;

/**
 * The link-page editor (ADR-0116 amendments 1 and 2): links, content and style on one side, a
 * live phone preview on the other that follows unsaved changes.
 */
export function EditorPage() {
  const api = useApi();
  const page = useQuery({ queryKey: key, queryFn: () => api.linkPage.get() });
  if (page.isError) return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  if (!page.data) return null;
  return <Editor key={page.data.version} page={page.data} />;
}

function Editor({ page }: { page: LinkPage }) {
  const [draft, setDraft] = useState<SaveLinkPage>(() => toForm(page));
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <LinksSection page={page} />
        <DesignForm page={page} v={draft} setV={setDraft} />
      </div>
      <Preview page={page} draft={draft} />
    </div>
  );
}

/** The page as visitors would see it with the unsaved design applied. */
export function previewData(page: LinkPage, d: SaveLinkPage): LinkPageViewData {
  const color = (c: string | null | undefined) => (c ? c : null);
  return {
    ...page,
    titleAr: d.titleAr || null,
    titleEn: d.titleEn || null,
    bioAr: d.bioAr || null,
    bioEn: d.bioEn || null,
    themeColor: d.themeColor,
    buttonStyle: d.buttonStyle,
    buttonVariant: d.buttonVariant ?? 'fill',
    buttonTextColor: color(d.buttonTextColor),
    background: d.background,
    backgroundColor: color(d.backgroundColor),
    backgroundColor2: color(d.backgroundColor2),
    textColor: color(d.textColor),
    font: d.font ?? 'default',
    animation: d.animation ?? 'fade-up',
    items: page.items.filter((i) => i.status === 'active'),
  };
}

function Preview({ page, draft }: { page: LinkPage; draft: SaveLinkPage }) {
  const { t, i18n } = useTranslation();
  return (
    <aside className="lg:sticky lg:top-20 lg:self-start" aria-label={t('linkPage.preview')}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t('linkPage.preview')}</h2>
        {page.status === 'published' ? (
          <a
            className="text-sm text-primary hover:underline"
            href={page.url}
            target="_blank"
            rel="noreferrer"
          >
            {t('linkPage.open')}
          </a>
        ) : null}
      </div>
      <p className="mb-3 text-sm text-fg-muted">{t('linkPage.previewHint')}</p>
      <div className="mx-auto h-[36rem] w-full max-w-[22rem] overflow-y-auto rounded-[2rem] border-8 border-fg/80 shadow-lg">
        <LinkPageView
          className="min-h-full"
          page={previewData(page, draft)}
          language={i18n.language}
          emptyLabel={t('linkPage.empty')}
        />
      </div>
    </aside>
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
    buttonVariant: p.buttonVariant,
    buttonTextColor: p.buttonTextColor,
    background: p.background,
    backgroundColor: p.backgroundColor,
    backgroundColor2: p.backgroundColor2,
    textColor: p.textColor,
    font: p.font,
    animation: p.animation,
    version: p.version,
  };
}

type Style = Pick<
  SaveLinkPage,
  | 'themeColor'
  | 'buttonStyle'
  | 'buttonVariant'
  | 'buttonTextColor'
  | 'background'
  | 'backgroundColor'
  | 'backgroundColor2'
  | 'textColor'
  | 'font'
>;

/** Ready-made looks applied in one click; every value stays editable afterwards. */
export const THEME_PRESETS: { key: string; style: Style }[] = [
  {
    key: 'classic',
    style: {
      themeColor: '#1e3a8a',
      buttonStyle: 'rounded',
      buttonVariant: 'fill',
      buttonTextColor: null,
      background: 'light',
      backgroundColor: null,
      backgroundColor2: null,
      textColor: null,
      font: 'default',
    },
  },
  {
    key: 'night',
    style: {
      themeColor: '#fbbf24',
      buttonStyle: 'pill',
      buttonVariant: 'outline',
      buttonTextColor: '#fbbf24',
      background: 'dark',
      backgroundColor: null,
      backgroundColor2: null,
      textColor: null,
      font: 'el-messiri',
    },
  },
  {
    key: 'sunset',
    style: {
      themeColor: '#ffffff',
      buttonStyle: 'pill',
      buttonVariant: 'soft',
      buttonTextColor: '#ffffff',
      background: 'gradient',
      backgroundColor: '#f97316',
      backgroundColor2: '#db2777',
      textColor: '#ffffff',
      font: 'cairo',
    },
  },
  {
    key: 'ocean',
    style: {
      themeColor: '#ffffff',
      buttonStyle: 'rounded',
      buttonVariant: 'fill',
      buttonTextColor: '#0e7490',
      background: 'gradient',
      backgroundColor: '#06b6d4',
      backgroundColor2: '#1e40af',
      textColor: '#ffffff',
      font: 'tajawal',
    },
  },
  {
    key: 'sand',
    style: {
      themeColor: '#7c2d12',
      buttonStyle: 'square',
      buttonVariant: 'shadow',
      buttonTextColor: null,
      background: 'custom',
      backgroundColor: '#f5e6c8',
      backgroundColor2: null,
      textColor: '#3f2a14',
      font: 'amiri',
    },
  },
  {
    key: 'mint',
    style: {
      themeColor: '#047857',
      buttonStyle: 'pill',
      buttonVariant: 'fill',
      buttonTextColor: null,
      background: 'custom',
      backgroundColor: '#ecfdf5',
      backgroundColor2: null,
      textColor: '#064e3b',
      font: 'almarai',
    },
  },
  {
    key: 'bold',
    style: {
      themeColor: '#111827',
      buttonStyle: 'square',
      buttonVariant: 'shadow',
      buttonTextColor: '#fde047',
      background: 'custom',
      backgroundColor: '#fde047',
      backgroundColor2: null,
      textColor: '#111827',
      font: 'changa',
    },
  },
  {
    key: 'royal',
    style: {
      themeColor: '#d4af37',
      buttonStyle: 'rounded',
      buttonVariant: 'outline',
      buttonTextColor: '#f5e6c8',
      background: 'gradient',
      backgroundColor: '#3b0764',
      backgroundColor2: '#1e1b4b',
      textColor: '#f5e6c8',
      font: 'reem-kufi',
    },
  },
];

/** One choice among a few, shown as buttons (aria-pressed). */
function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
  render,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  render: (option: T) => ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            onClick={() => onChange(o)}
            className={`rounded-md border px-3 py-1.5 text-sm transition ${
              value === o
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-border hover:bg-surface-muted'
            }`}
          >
            {render(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A colour, optionally "automatic" (null: picked for contrast). */
function ColorField({
  label,
  value,
  fallback,
  onChange,
  optional,
}: {
  label: string;
  value: string | null | undefined;
  fallback: string;
  onChange: (value: string | null) => void;
  optional?: boolean;
}) {
  const { t } = useTranslation();
  const auto = optional && !value;
  return (
    <Field label={label}>
      {(p) => (
        <div className="flex items-center gap-3">
          <Input
            {...p}
            type="color"
            className="h-10 w-16 p-1"
            disabled={auto}
            value={value || fallback}
            onChange={(e) => onChange(e.target.value)}
          />
          {optional ? (
            <Checkbox
              label={t('linkPage.auto')}
              checked={auto}
              onChange={(e) => onChange(e.target.checked ? null : fallback)}
            />
          ) : null}
        </div>
      )}
    </Field>
  );
}

function DesignForm({
  page,
  v,
  setV,
}: {
  page: LinkPage;
  v: SaveLinkPage;
  setV: Dispatch<SetStateAction<SaveLinkPage>>;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<SaveLinkPage>) => setV((x) => ({ ...x, ...patch }));
  // The font buttons are drawn in their own typeface.
  useEffect(() => LINK_FONTS.forEach(loadLinkFont), []);
  const done = async (saved: LinkPage, message: string) => {
    queryClient.setQueryData(key, saved);
    await queryClient.invalidateQueries({ queryKey: key });
    notify.ok(message);
  };
  const save = useMutation({
    mutationFn: () => api.linkPage.save(v),
    onSuccess: (saved) => done(saved, t('linkPage.saved')),
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
  const changed = JSON.stringify(v) !== JSON.stringify(toForm(page));
  const sample = i18n.language.startsWith('ar') ? 'أبجد' : 'Aa';
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
        </div>
      </Section>
      <Section title={t('linkPage.styleSection')} description={t('linkPage.styleHint')}>
        <div className="flex flex-col gap-6">
          <div role="group" aria-label={t('linkPage.presets')} className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('linkPage.presets')}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {THEME_PRESETS.map(({ key: name, style }) => {
                const theme = linkPageTheme({
                  ...style,
                  buttonVariant: style.buttonVariant ?? 'fill',
                  buttonTextColor: style.buttonTextColor ?? null,
                  backgroundColor: style.backgroundColor ?? null,
                  backgroundColor2: style.backgroundColor2 ?? null,
                  textColor: style.textColor ?? null,
                });
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => set(style)}
                    className="flex flex-col items-center gap-2 rounded-lg border border-border p-3 text-sm transition hover:-translate-y-0.5 hover:shadow"
                    style={{ ...theme.page, fontFamily: LINK_FONT_FAMILY[style.font ?? 'default'] }}
                  >
                    <span aria-hidden className="h-4 w-full rounded-full" style={theme.button} />
                    {t(`linkPage.preset_${name}`)}
                  </button>
                );
              })}
            </div>
          </div>
          <Chips
            label={t('linkPage.background')}
            options={LINK_BACKGROUNDS}
            value={v.background}
            onChange={(background) =>
              set({
                background,
                backgroundColor:
                  background === 'custom' || background === 'gradient'
                    ? v.backgroundColor || '#fef3c7'
                    : v.backgroundColor,
                backgroundColor2:
                  background === 'gradient' ? v.backgroundColor2 || '#f472b6' : v.backgroundColor2,
              })
            }
            render={(o) => t(`linkPage.background_${o}`)}
          />
          {v.background === 'custom' || v.background === 'gradient' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField
                label={
                  v.background === 'gradient'
                    ? t('linkPage.gradientFrom')
                    : t('linkPage.backgroundColor')
                }
                value={v.backgroundColor}
                fallback="#fef3c7"
                onChange={(c) => set({ backgroundColor: c })}
              />
              {v.background === 'gradient' ? (
                <ColorField
                  label={t('linkPage.gradientTo')}
                  value={v.backgroundColor2}
                  fallback="#f472b6"
                  onChange={(c) => set({ backgroundColor2: c })}
                />
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <ColorField
              label={t('linkPage.color')}
              value={v.themeColor}
              fallback="#1e3a8a"
              onChange={(c) => set({ themeColor: c ?? '#1e3a8a' })}
            />
            <ColorField
              label={t('linkPage.buttonTextColor')}
              value={v.buttonTextColor}
              fallback="#ffffff"
              optional
              onChange={(c) => set({ buttonTextColor: c })}
            />
            <ColorField
              label={t('linkPage.textColor')}
              value={v.textColor}
              fallback="#0f172a"
              optional
              onChange={(c) => set({ textColor: c })}
            />
          </div>
          <Chips
            label={t('linkPage.buttonVariant')}
            options={LINK_BUTTON_VARIANTS}
            value={v.buttonVariant ?? 'fill'}
            onChange={(buttonVariant) => set({ buttonVariant })}
            render={(o) => t(`linkPage.variant_${o}`)}
          />
          <Chips
            label={t('linkPage.buttonStyle')}
            options={LINK_BUTTON_STYLES}
            value={v.buttonStyle}
            onChange={(buttonStyle) => set({ buttonStyle })}
            render={(o) => t(`linkPage.button_${o}`)}
          />
          <Chips
            label={t('linkPage.font')}
            options={LINK_FONTS}
            value={v.font ?? 'default'}
            onChange={(font) => set({ font })}
            render={(o) => (
              <span
                className="flex flex-col items-center"
                style={{ fontFamily: LINK_FONT_FAMILY[o] }}
              >
                <span className="text-lg leading-tight">{sample}</span>
                <span className="text-xs">{t(`linkPage.font_${o}`)}</span>
              </span>
            )}
          />
          <Chips
            label={t('linkPage.animation')}
            options={LINK_ANIMATIONS}
            value={v.animation ?? 'fade-up'}
            onChange={(animation) => set({ animation })}
            render={(o) => t(`linkPage.animation_${o}`)}
          />
        </div>
      </Section>
      <div className="sticky bottom-0 z-10 -mx-1 flex items-center gap-3 rounded-lg border border-border bg-surface/95 p-3 shadow-sm backdrop-blur">
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          {t('linkPage.save')}
        </Button>
        {changed ? <Badge tone="warning">{t('linkPage.unsaved')}</Badge> : null}
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
                  {item.emoji ? <span aria-hidden>{item.emoji}</span> : null}
                  {label(item)}
                  <Badge tone="neutral">{t(`linkPage.kind_${item.kind}`)}</Badge>
                  {item.status === 'hidden' ? (
                    <Badge tone="warning">{t('linkPage.hidden')}</Badge>
                  ) : null}
                  {item.effect !== 'none' ? (
                    <Badge tone="primary">{t(`linkPage.effect_${item.effect}`)}</Badge>
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
                {t('linkPage.edit')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleting(item)}>
                {t('linkPage.delete')}
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
        confirmLabel={t('linkPage.delete')}
        cancelLabel={t('linkPage.cancel')}
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
          emoji: item.emoji,
          effect: item.effect,
          url: item.url,
          status: item.status,
          version: item.version,
        }
      : {
          kind: 'instagram',
          labelAr: '',
          labelEn: '',
          emoji: null,
          effect: 'none',
          url: '',
          status: 'active',
          version: 0,
        },
  );
  const set = (patch: Partial<SaveLinkItem>) => setV((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: () =>
      api.linkPage.saveItem(item?.id ?? null, { ...v, url: normalizeLinkUrl(v.kind, v.url) }),
    onSuccess: async (saved) => {
      await onSaved(saved);
      notify.ok(t('linkPage.saved'));
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
            {t('linkPage.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('linkPage.save')}
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
        <div role="group" aria-label={t('linkPage.emoji')} className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('linkPage.emoji')}</span>
          <div className="flex flex-wrap items-center gap-1">
            {EMOJI_CHOICES.map((e) => (
              <button
                key={e}
                type="button"
                aria-pressed={v.emoji === e}
                onClick={() => set({ emoji: v.emoji === e ? null : e })}
                className={`grid size-9 place-items-center rounded-md text-xl transition ${
                  v.emoji === e ? 'bg-primary-soft ring-2 ring-primary' : 'hover:bg-surface-muted'
                }`}
              >
                {e}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              className="w-28 text-center text-xl"
              aria-label={t('linkPage.emojiOwn')}
              placeholder="🙂"
              maxLength={16}
              value={v.emoji ?? ''}
              onChange={(e) => set({ emoji: e.target.value || null })}
            />
            {v.emoji ? (
              <Button size="sm" variant="ghost" onClick={() => set({ emoji: null })}>
                {t('linkPage.emojiNone')}
              </Button>
            ) : null}
            <span className="text-xs text-fg-muted">{t('linkPage.emojiHint')}</span>
          </div>
        </div>
        <Field label={t('linkPage.effect')} hint={t('linkPage.effectHint')}>
          {(p) => (
            <Select
              {...p}
              value={v.effect ?? 'none'}
              onChange={(e) => set({ effect: e.target.value as SaveLinkItem['effect'] })}
            >
              {LINK_ITEM_EFFECTS.map((x) => (
                <option key={x} value={x}>
                  {t(`linkPage.effect_${x}`)}
                </option>
              ))}
            </Select>
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
