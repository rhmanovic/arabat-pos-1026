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
  ColorInput,
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
  LinkIcon,
  LinkPageView,
  type LinkPageViewData,
  linkPageTheme,
  loadLinkFont,
  readableOn,
  useApi,
  useNotify,
} from '@arabat/web-core';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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

type Tab = 'links' | 'appearance' | 'settings';
const TABS: readonly Tab[] = ['links', 'appearance', 'settings'];

/**
 * The link-page editor (ADR-0116 amendments 1–3): a header with the page address and a publish
 * switch, tabs for the links (drag to reorder), the appearance and the settings, and a live
 * phone preview that follows unsaved changes.
 */
export function EditorPage() {
  const api = useApi();
  const page = useQuery({ queryKey: key, queryFn: () => api.linkPage.get() });
  // Kept here so saving (which re-mounts the editor with the new version) stays on the tab.
  const [tab, setTab] = useState<Tab>('links');
  if (page.isError) return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  if (!page.data) return null;
  return <Editor key={page.data.version} page={page.data} tab={tab} setTab={setTab} />;
}

function Editor({ page, tab, setTab }: { page: LinkPage; tab: Tab; setTab: (t: Tab) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<SaveLinkPage>(() => toForm(page));
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <Hero page={page} draft={draft} />
        <div
          role="tablist"
          aria-label={t('linkPage.sections')}
          className="sticky top-16 z-10 flex gap-1 self-start rounded-full bg-surface-muted p-1 shadow-sm ring-1 ring-border"
        >
          {TABS.map((x) => (
            <button
              key={x}
              type="button"
              role="tab"
              aria-selected={tab === x}
              onClick={() => setTab(x)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                tab === x ? 'bg-surface text-primary shadow' : 'text-fg-muted hover:text-fg'
              }`}
            >
              {t(`linkPage.tab_${x}`)}
            </button>
          ))}
        </div>
        <div role="tabpanel" key={tab} className="lp-enter-fade-up flex flex-col gap-4">
          {tab === 'links' ? <LinksSection page={page} /> : null}
          {tab !== 'links' ? <DesignForm page={page} v={draft} setV={setDraft} part={tab} /> : null}
        </div>
      </div>
      <Preview page={page} draft={draft} />
    </div>
  );
}

/** Page address, copy / open, and the publish switch (it saves the current design too). */
function Hero({ page, draft }: { page: LinkPage; draft: SaveLinkPage }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const published = page.status === 'published';
  const publish = useMutation({
    mutationFn: (status: SaveLinkPage['status']) => api.linkPage.save({ ...draft, status }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(key, saved);
      await queryClient.invalidateQueries({ queryKey: key });
      notify.ok(saved.status === 'published' ? t('linkPage.nowPublished') : t('linkPage.nowDraft'));
    },
    onError: notify.fail,
  });
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-violet-600 p-5 text-white shadow-lg sm:p-6">
      <div aria-hidden className="absolute -end-10 -top-10 size-40 rounded-full bg-white/10" />
      <div aria-hidden className="absolute -bottom-12 end-24 size-28 rounded-full bg-white/10" />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-white/80">{t('linkPage.url')}</p>
          <p className="mt-1 truncate text-lg font-semibold" dir="ltr">
            {page.url.replace(/^https?:\/\//, '')}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={published}
          aria-label={t('linkPage.publishSwitch')}
          disabled={publish.isPending}
          onClick={() => publish.mutate(published ? 'draft' : 'published')}
          className="flex items-center gap-3 rounded-full bg-white/15 py-1.5 pe-4 ps-1.5 text-sm font-semibold backdrop-blur transition hover:bg-white/25 disabled:opacity-60"
        >
          <span
            className={`relative h-7 w-12 rounded-full transition ${published ? 'bg-emerald-400' : 'bg-white/30'}`}
          >
            <span
              className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${
                published ? 'start-6' : 'start-1'
              }`}
            />
          </span>
          {published ? t('linkPage.status_published') : t('linkPage.status_draft')}
        </button>
      </div>
      <div className="relative mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(page.url)
              .then(() => notify.ok(t('linkPage.copied')))
              .catch(() => undefined)
          }
          className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-primary shadow-sm transition hover:scale-105 active:scale-95"
        >
          {t('linkPage.copy')}
        </button>
        {published ? (
          <a
            href={page.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold backdrop-blur transition hover:bg-white/25"
          >
            {t('linkPage.open')} ↗
          </a>
        ) : (
          <span className="rounded-full bg-amber-300/90 px-3 py-2 text-xs font-semibold text-amber-950">
            {t('linkPage.notPublished')}
          </span>
        )}
      </div>
    </section>
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
      <div className="relative mx-auto h-[38rem] w-full max-w-[22rem] overflow-y-auto rounded-[2.75rem] border-[10px] border-neutral-900 bg-neutral-900 shadow-2xl">
        <div
          aria-hidden
          className="pointer-events-none sticky top-0 z-10 mx-auto -mb-5 h-5 w-28 rounded-b-2xl bg-neutral-900"
        />
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
          <ColorInput
            id={p.id}
            label={label}
            disabled={auto}
            value={value || fallback}
            onChange={onChange}
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
  part,
}: {
  page: LinkPage;
  v: SaveLinkPage;
  setV: Dispatch<SetStateAction<SaveLinkPage>>;
  part: 'appearance' | 'settings';
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
  const changed = JSON.stringify(v) !== JSON.stringify(toForm(page));
  const sample = i18n.language.startsWith('ar') ? 'أبجد' : 'Aa';
  return (
    <>
      {part === 'settings' ? (
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
            <p className="text-sm text-fg-muted sm:col-span-2">
              {t('linkPage.url')}: <span dir="ltr">{page.url}</span>
            </p>
          </div>
        </Section>
      ) : null}
      {part === 'appearance' ? (
        <>
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
              <div
                role="group"
                aria-label={t('linkPage.presets')}
                className="flex flex-col gap-1.5"
              >
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
                        style={{
                          ...theme.page,
                          fontFamily: LINK_FONT_FAMILY[style.font ?? 'default'],
                        }}
                      >
                        <span
                          aria-hidden
                          className="h-4 w-full rounded-full"
                          style={theme.button}
                        />
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
                      background === 'gradient'
                        ? v.backgroundColor2 || '#f472b6'
                        : v.backgroundColor2,
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
        </>
      ) : null}
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
/** Colour of each link type's badge in the editor list. */
const KIND_COLOR: Record<LinkItemKind, string> = {
  link: '#64748b',
  website: '#0f766e',
  store: '#7c3aed',
  instagram: '#e1306c',
  tiktok: '#111827',
  snapchat: '#facc15',
  x: '#111827',
  facebook: '#1877f2',
  youtube: '#ff0000',
  whatsapp: '#25d366',
  telegram: '#229ed9',
  email: '#6366f1',
  phone: '#0ea5e9',
  location: '#f97316',
};

/** Links of the page as cards: drag (pointer, touch or keyboard) to reorder, quick show/hide. */
function LinksSection({ page }: { page: LinkPage }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<LinkItem | 'new' | null>(null);
  const [deleting, setDeleting] = useState<LinkItem | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const done = async (saved: LinkPage) => {
    queryClient.setQueryData(key, saved);
    await queryClient.invalidateQueries({ queryKey: key });
  };
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.linkPage.reorder(ids),
    // The new order shows at once; a refusal reloads the saved one.
    onMutate: (ids) => {
      const byId = new Map(page.items.map((i) => [i.id, i]));
      queryClient.setQueryData<LinkPage>(key, {
        ...page,
        items: ids.map((id, n) => ({ ...byId.get(id)!, sortOrder: n })),
      });
    },
    onSuccess: done,
    onError: async (error) => {
      notify.fail(error);
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const toggle = useMutation({
    mutationFn: (item: LinkItem) =>
      api.linkPage.saveItem(item.id, {
        kind: item.kind,
        labelAr: item.labelAr,
        labelEn: item.labelEn,
        emoji: item.emoji,
        effect: item.effect,
        url: item.url,
        status: item.status === 'active' ? 'hidden' : 'active',
        version: item.version,
      }),
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
  const ids = page.items.map((i) => i.id);
  const move = (from: number, to: number) => reorder.mutate(arrayMove(ids, from, to));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    move(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };
  const ar = i18n.language.startsWith('ar');
  const label = (i: LinkItem) => (ar ? i.labelAr || i.labelEn : i.labelEn || i.labelAr) ?? '';
  return (
    <section className="flex flex-col gap-3" aria-label={t('linkPage.linksSection')}>
      <button
        type="button"
        onClick={() => setEditing('new')}
        className="group flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-primary-soft/40 p-4 font-semibold text-primary transition hover:border-primary hover:bg-primary-soft"
      >
        <span
          aria-hidden
          className="grid size-7 place-items-center rounded-full bg-primary text-lg leading-none text-primary-fg transition group-hover:rotate-90"
        >
          +
        </span>
        {t('linkPage.add')}
      </button>
      {page.items.length === 0 ? (
        <EmptyState title={t('linkPage.noLinks')} description={t('linkPage.noLinksHint')} />
      ) : (
        <>
          <p className="text-xs text-fg-muted">{t('linkPage.dragHint')}</p>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={onDragEnd}
            accessibility={{
              screenReaderInstructions: { draggable: t('linkPage.dragInstructions') },
            }}
          >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col gap-3">
                {page.items.map((item, index) => (
                  <LinkCard
                    key={item.id}
                    item={item}
                    label={label(item)}
                    first={index === 0}
                    last={index === page.items.length - 1}
                    busy={reorder.isPending}
                    toggling={toggle.isPending && toggle.variables?.id === item.id}
                    onMove={(by) => move(index, index + by)}
                    onToggle={() => toggle.mutate(item)}
                    onEdit={() => setEditing(item)}
                    onDelete={() => setDeleting(item)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
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
    </section>
  );
}

const iconButton =
  'grid size-9 place-items-center rounded-full text-fg-muted transition hover:bg-surface-muted hover:text-fg disabled:opacity-30';

function LinkCard({
  item,
  label,
  first,
  last,
  busy,
  toggling,
  onMove,
  onToggle,
  onEdit,
  onDelete,
}: {
  item: LinkItem;
  label: string;
  first: boolean;
  last: boolean;
  busy: boolean;
  toggling: boolean;
  onMove: (by: -1 | 1) => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });
  const color = KIND_COLOR[item.kind];
  const visible = item.status === 'active';
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-dragging={isDragging || undefined}
      className={`group relative flex flex-wrap items-center gap-3 rounded-2xl sm:flex-nowrap border border-border bg-surface p-3 shadow-sm transition-shadow hover:shadow-md ${
        isDragging ? 'z-20 scale-[1.02] shadow-2xl ring-2 ring-primary' : ''
      } ${visible ? '' : 'opacity-60'}`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t('linkPage.dragHandle', { name: label })}
        className="grid h-10 w-6 shrink-0 cursor-grab touch-none place-items-center rounded-md text-fg-subtle hover:bg-surface-muted hover:text-fg active:cursor-grabbing"
      >
        <svg viewBox="0 0 12 20" width="12" height="20" fill="currentColor" aria-hidden>
          {[3, 10, 17].map((y) => (
            <g key={y}>
              <circle cx="3" cy={y} r="1.6" />
              <circle cx="9" cy={y} r="1.6" />
            </g>
          ))}
        </svg>
      </button>
      <span
        aria-hidden
        className="grid size-11 shrink-0 place-items-center rounded-xl text-xl shadow-sm"
        style={
          item.emoji
            ? { backgroundColor: `${color}22` }
            : { backgroundColor: color, color: readableOn(color) }
        }
      >
        {item.emoji ?? <LinkIcon kind={item.kind} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          <span className="truncate">{label}</span>
          {item.effect !== 'none' ? (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
              ✨ {t(`linkPage.effect_${item.effect}`)}
            </span>
          ) : null}
        </p>
        <p className="truncate text-sm text-fg-muted" dir="ltr">
          {item.url}
        </p>
      </div>
      <div className="flex w-full items-center gap-1 border-t border-border pt-2 sm:w-auto sm:border-0 sm:pt-0">
        <span className="me-auto shrink-0 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-fg-muted sm:me-2">
          {t('linkPage.clicks', { count: item.clicks })}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={visible}
          aria-label={t('linkPage.visibleSwitch', { name: label })}
          title={visible ? t('linkPage.visible') : t('linkPage.hidden')}
          disabled={toggling}
          onClick={onToggle}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${visible ? 'bg-emerald-500' : 'bg-border-strong'}`}
        >
          <span
            className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${
              visible ? 'start-[1.375rem]' : 'start-0.5'
            }`}
          />
        </button>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            className={iconButton}
            aria-label={`${t('linkPage.edit')} ${label}`}
            title={t('linkPage.edit')}
            onClick={onEdit}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
          </button>
          <button
            type="button"
            className={`${iconButton} hover:!text-danger`}
            aria-label={`${t('linkPage.delete')} ${label}`}
            title={t('linkPage.delete')}
            onClick={onDelete}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
            </svg>
          </button>
          {/* Buttons for moving without dragging (keyboard and screen readers, small screens). */}
          <div className="flex flex-col">
            <button
              type="button"
              className="grid h-5 w-7 place-items-center rounded text-xs text-fg-subtle hover:bg-surface-muted disabled:opacity-20"
              aria-label={t('linkPage.moveUp', { name: label })}
              disabled={first || busy}
              onClick={() => onMove(-1)}
            >
              ▲
            </button>
            <button
              type="button"
              className="grid h-5 w-7 place-items-center rounded text-xs text-fg-subtle hover:bg-surface-muted disabled:opacity-20"
              aria-label={t('linkPage.moveDown', { name: label })}
              disabled={last || busy}
              onClick={() => onMove(1)}
            >
              ▼
            </button>
          </div>
        </div>
      </div>
    </li>
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
