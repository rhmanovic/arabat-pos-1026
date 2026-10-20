import {
  type DesignPage,
  type DesignSection,
  type DesignTemplate,
  type SectionOf,
  type SectionType,
  SECTION_TYPES,
  videoEmbed,
} from '@arabat/contracts';
import { Button, Field, Input, Select } from '@arabat/ui';
import { localizedName } from '@arabat/web-core';
import { useTranslation } from 'react-i18next';
import {
  Choice,
  Group,
  ImagePicker,
  LinkPicker,
  LocalizedField,
  MultiPick,
  Toggle,
  useStoreCatalog,
} from './fields.js';

export const SECTION_ICON: Record<SectionType, string> = {
  slider: '🎞️',
  banner: '🖼️',
  products: '🛍️',
  categories: '🗂️',
  image: '📷',
  video: '🎬',
  text: '📝',
  features: '✨',
  menu: '🍽️',
  info: 'ℹ️',
  catalog: '🔎',
};

/** Sections suggested first for each kind of business (ADR-0128). */
export function sectionOrder(template: DesignTemplate): SectionType[] {
  const first: SectionType[] =
    template === 'restaurant'
      ? ['menu', 'info', 'banner', 'products', 'slider', 'categories']
      : ['slider', 'products', 'categories', 'banner', 'features', 'catalog'];
  return [...first, ...SECTION_TYPES.filter((t) => !first.includes(t))];
}

/** The section that a page cannot lose (the product list, the category list). */
export function isRequired(page: DesignPage, section: DesignSection, all: DesignSection[]) {
  if (page === 'products' && (section.type === 'catalog' || section.type === 'menu'))
    return all.filter((s) => s.type === 'catalog' || s.type === 'menu').length === 1;
  if (page === 'categories' && section.type === 'categories')
    return all.filter((s) => s.type === 'categories').length === 1;
  return false;
}

export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** One-line summary of a section in the list. */
export function useSectionSummary() {
  const { t } = useTranslation();
  return (s: DesignSection) => {
    const variant = 'variant' in s ? t(`design.variant_${s.variant}`) : '';
    const extra =
      s.type === 'slider'
        ? t('design.slides', { count: s.slides.length })
        : s.type === 'products'
          ? t(`design.source_${s.source}`)
          : s.type === 'features'
            ? t('design.items', { count: s.items.length })
            : '';
    return [variant, extra].filter(Boolean).join(' · ');
  };
}

type Patch<T> = (patch: Partial<T>) => void;

export function SectionEditor({
  section,
  onChange,
}: {
  section: DesignSection;
  onChange: (next: DesignSection) => void;
}) {
  const patch = (p: Partial<DesignSection>) => onChange({ ...section, ...p } as DesignSection);
  switch (section.type) {
    case 'slider':
      return <SliderEditor s={section} set={patch as Patch<SectionOf<'slider'>>} />;
    case 'banner':
      return <BannerEditor s={section} set={patch as Patch<SectionOf<'banner'>>} />;
    case 'products':
      return <ProductsEditor s={section} set={patch as Patch<SectionOf<'products'>>} />;
    case 'categories':
      return <CategoriesEditor s={section} set={patch as Patch<SectionOf<'categories'>>} />;
    case 'image':
      return <ImageEditor s={section} set={patch as Patch<SectionOf<'image'>>} />;
    case 'video':
      return <VideoEditor s={section} set={patch as Patch<SectionOf<'video'>>} />;
    case 'text':
      return <TextEditor s={section} set={patch as Patch<SectionOf<'text'>>} />;
    case 'features':
      return <FeaturesEditor s={section} set={patch as Patch<SectionOf<'features'>>} />;
    case 'menu':
      return <MenuEditor s={section} set={patch as Patch<SectionOf<'menu'>>} />;
    case 'info':
      return <InfoEditor s={section} set={patch as Patch<SectionOf<'info'>>} />;
    case 'catalog':
      return <CatalogEditor s={section} set={patch as Patch<SectionOf<'catalog'>>} />;
  }
}

function useVariants<T extends string>(values: readonly T[]) {
  const { t } = useTranslation();
  return values.map((v) => ({ value: v, label: t(`design.variant_${v}`) }));
}

function SliderEditor({ s, set }: { s: SectionOf<'slider'>; set: Patch<SectionOf<'slider'>> }) {
  const { t } = useTranslation();
  const variants = useVariants(['full', 'contained', 'cards'] as const);
  const slides = s.slides;
  const setSlide = (i: number, p: Partial<(typeof slides)[number]>) =>
    set({ slides: slides.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const move = (i: number, by: -1 | 1) => {
    const next = [...slides];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item!);
    set({ slides: next });
  };
  return (
    <div className="flex flex-col gap-4">
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={variants}
        onChange={(v) => set({ variant: v })}
      />
      <Toggle
        label={t('design.autoplay')}
        checked={s.autoplay}
        onChange={(v) => set({ autoplay: v })}
      />
      {slides.map((slide, i) => (
        <Group key={slide.id} title={t('design.slideN', { n: i + 1 })}>
          <ImagePicker
            label={t('design.image')}
            value={slide.imageId}
            onChange={(v) => setSlide(i, { imageId: v })}
          />
          <LocalizedField
            label={t('design.title')}
            value={slide.title}
            max={80}
            onChange={(v) => setSlide(i, { title: v })}
          />
          <LocalizedField
            label={t('design.subtitle')}
            value={slide.subtitle}
            max={160}
            onChange={(v) => setSlide(i, { subtitle: v })}
          />
          <LocalizedField
            label={t('design.button')}
            value={slide.button}
            max={30}
            onChange={(v) => setSlide(i, { button: v })}
          />
          <LinkPicker
            label={t('design.link')}
            value={slide.link}
            onChange={(v) => setSlide(i, { link: v })}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={i === 0} onClick={() => move(i, -1)}>
              {t('design.moveUp')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={i === slides.length - 1}
              onClick={() => move(i, 1)}
            >
              {t('design.moveDown')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => set({ slides: slides.filter((_, j) => j !== i) })}
            >
              {t('design.removeSlide')}
            </Button>
          </div>
        </Group>
      ))}
      {slides.length < 8 ? (
        <Button
          variant="secondary"
          onClick={() =>
            set({
              slides: [
                ...slides,
                {
                  id: `slide-${Date.now().toString(36)}`,
                  imageId: null,
                  title: { en: null, ar: null },
                  subtitle: { en: null, ar: null },
                  button: { en: null, ar: null },
                  link: null,
                },
              ],
            })
          }
        >
          {t('design.addSlide')}
        </Button>
      ) : null}
    </div>
  );
}

function BannerEditor({ s, set }: { s: SectionOf<'banner'>; set: Patch<SectionOf<'banner'>> }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['overlay', 'split', 'color'] as const)}
        onChange={(v) => set({ variant: v })}
      />
      <Choice
        label={t('design.imageSource')}
        value={s.imageSource}
        options={[
          { value: 'store', label: t('design.imageSource_store') },
          { value: 'upload', label: t('design.imageSource_upload') },
          { value: 'none', label: t('design.imageSource_none') },
        ]}
        onChange={(v) => set({ imageSource: v })}
      />
      {s.imageSource === 'upload' ? (
        <ImagePicker
          label={t('design.image')}
          value={s.imageId}
          onChange={(v) => set({ imageId: v })}
        />
      ) : null}
      <LocalizedField
        label={t('design.title')}
        value={s.title}
        max={80}
        onChange={(v) => set({ title: v })}
      />
      <LocalizedField
        label={t('design.subtitle')}
        value={s.subtitle}
        max={200}
        onChange={(v) => set({ subtitle: v })}
      />
      <LocalizedField
        label={t('design.button')}
        value={s.button}
        max={30}
        onChange={(v) => set({ button: v })}
      />
      <LinkPicker label={t('design.link')} value={s.link} onChange={(v) => set({ link: v })} />
      <Choice
        label={t('design.align')}
        value={s.align}
        options={[
          { value: 'start', label: t('design.align_start') },
          { value: 'center', label: t('design.align_center') },
        ]}
        onChange={(v) => set({ align: v })}
      />
    </div>
  );
}

function ProductsEditor({
  s,
  set,
}: {
  s: SectionOf<'products'>;
  set: Patch<SectionOf<'products'>>;
}) {
  const { t, i18n } = useTranslation();
  const { store, products } = useStoreCatalog();
  return (
    <div className="flex flex-col gap-4">
      <LocalizedField
        label={t('design.title')}
        value={s.title}
        max={80}
        onChange={(v) => set({ title: v })}
      />
      <Choice
        label={t('design.source')}
        value={s.source}
        options={(['featured', 'all', 'category', 'manual'] as const).map((v) => ({
          value: v,
          label: t(`design.source_${v}`),
        }))}
        onChange={(v) => set({ source: v })}
      />
      {s.source === 'category' ? (
        <Field label={t('design.link_category')}>
          {(p) => (
            <Select
              {...p}
              value={s.categoryId ?? ''}
              onChange={(e) => set({ categoryId: e.target.value || null })}
            >
              <option value="">{t('design.chooseCategory')}</option>
              {(store?.categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {localizedName(c, i18n.language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      {s.source === 'manual' ? (
        <MultiPick
          label={t('design.chooseProducts')}
          emptyMeansAll={false}
          options={products.map((p) => ({
            id: p.productId,
            label: localizedName(p, i18n.language),
          }))}
          value={s.productIds}
          onChange={(v) => set({ productIds: v.slice(0, 24) })}
        />
      ) : null}
      <Field label={t('design.limit')}>
        {(p) => (
          <Input
            {...p}
            type="number"
            min={1}
            max={24}
            value={s.limit}
            onChange={(e) => set({ limit: Math.min(24, Math.max(1, Number(e.target.value) || 1)) })}
          />
        )}
      </Field>
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['grid', 'carousel', 'list'] as const)}
        onChange={(v) => set({ variant: v })}
      />
      {s.variant === 'grid' ? (
        <Choice
          label={t('design.columns')}
          value={s.columns}
          options={[2, 3, 4].map((n) => ({ value: n, label: String(n) }))}
          onChange={(v) => set({ columns: v })}
        />
      ) : null}
    </div>
  );
}

function CategoriesEditor({
  s,
  set,
}: {
  s: SectionOf<'categories'>;
  set: Patch<SectionOf<'categories'>>;
}) {
  const { t, i18n } = useTranslation();
  const { store } = useStoreCatalog();
  return (
    <div className="flex flex-col gap-4">
      <LocalizedField
        label={t('design.title')}
        value={s.title}
        max={80}
        onChange={(v) => set({ title: v })}
      />
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['tiles', 'circles', 'chips', 'list'] as const)}
        onChange={(v) => set({ variant: v })}
      />
      <MultiPick
        label={t('design.chooseCategories')}
        options={(store?.categories ?? []).map((c) => ({
          id: c.id,
          label: localizedName(c, i18n.language),
        }))}
        value={s.categoryIds}
        onChange={(v) => set({ categoryIds: v })}
      />
    </div>
  );
}

function ImageEditor({ s, set }: { s: SectionOf<'image'>; set: Patch<SectionOf<'image'>> }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <ImagePicker
        label={t('design.image')}
        value={s.imageId}
        onChange={(v) => set({ imageId: v })}
      />
      <LocalizedField
        label={t('design.alt')}
        value={s.alt}
        max={120}
        onChange={(v) => set({ alt: v })}
      />
      <LinkPicker label={t('design.link')} value={s.link} onChange={(v) => set({ link: v })} />
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['contained', 'full'] as const)}
        onChange={(v) => set({ variant: v })}
      />
      <Choice
        label={t('design.aspect')}
        value={s.aspect}
        options={(['wide', 'square', 'tall', 'auto'] as const).map((v) => ({
          value: v,
          label: t(`design.aspect_${v}`),
        }))}
        onChange={(v) => set({ aspect: v })}
      />
    </div>
  );
}

function VideoEditor({ s, set }: { s: SectionOf<'video'>; set: Patch<SectionOf<'video'>> }) {
  const { t } = useTranslation();
  const bad = s.url !== '' && videoEmbed(s.url) === null;
  return (
    <div className="flex flex-col gap-4">
      <Field
        label={t('design.videoUrl')}
        hint={t('design.videoHint')}
        error={bad ? t('design.videoBad') : undefined}
      >
        {(p) => (
          <Input
            {...p}
            dir="ltr"
            value={s.url}
            placeholder="https://youtu.be/…"
            onChange={(e) => set({ url: e.target.value })}
          />
        )}
      </Field>
      <LocalizedField
        label={t('design.title')}
        value={s.title}
        max={80}
        onChange={(v) => set({ title: v })}
      />
      <Choice
        label={t('design.aspect')}
        value={s.aspect}
        options={[
          { value: 'landscape', label: t('design.aspect_landscape') },
          { value: 'portrait', label: t('design.aspect_portrait') },
        ]}
        onChange={(v) => set({ aspect: v })}
      />
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['contained', 'full'] as const)}
        onChange={(v) => set({ variant: v })}
      />
    </div>
  );
}

function TextEditor({ s, set }: { s: SectionOf<'text'>; set: Patch<SectionOf<'text'>> }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <LocalizedField
        label={t('design.title')}
        value={s.title}
        max={120}
        onChange={(v) => set({ title: v })}
      />
      <LocalizedField
        label={t('design.body')}
        value={s.body}
        max={2000}
        multiline
        onChange={(v) => set({ body: v })}
      />
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['plain', 'card', 'highlight'] as const)}
        onChange={(v) => set({ variant: v })}
      />
      <Choice
        label={t('design.align')}
        value={s.align}
        options={[
          { value: 'start', label: t('design.align_start') },
          { value: 'center', label: t('design.align_center') },
        ]}
        onChange={(v) => set({ align: v })}
      />
    </div>
  );
}

function FeaturesEditor({
  s,
  set,
}: {
  s: SectionOf<'features'>;
  set: Patch<SectionOf<'features'>>;
}) {
  const { t } = useTranslation();
  const setItem = (i: number, p: Partial<(typeof s.items)[number]>) =>
    set({ items: s.items.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  return (
    <div className="flex flex-col gap-4">
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['row', 'grid', 'cards'] as const)}
        onChange={(v) => set({ variant: v })}
      />
      {s.items.map((item, i) => (
        <Group key={item.id} title={t('design.itemN', { n: i + 1 })}>
          <Field label={t('design.icon')} hint={t('design.iconHint')}>
            {(p) => (
              <Input
                {...p}
                className="w-24"
                maxLength={8}
                value={item.icon}
                onChange={(e) => setItem(i, { icon: e.target.value })}
              />
            )}
          </Field>
          <LocalizedField
            label={t('design.title')}
            value={item.title}
            max={60}
            onChange={(v) => setItem(i, { title: v })}
          />
          <LocalizedField
            label={t('design.text')}
            value={item.text}
            max={160}
            onChange={(v) => setItem(i, { text: v })}
          />
          <Button
            size="sm"
            variant="ghost"
            className="w-fit"
            onClick={() => set({ items: s.items.filter((_, j) => j !== i) })}
          >
            {t('design.removeItem')}
          </Button>
        </Group>
      ))}
      {s.items.length < 6 ? (
        <Button
          variant="secondary"
          onClick={() =>
            set({
              items: [
                ...s.items,
                {
                  id: `item-${Date.now().toString(36)}`,
                  icon: '⭐',
                  title: { en: null, ar: null },
                  text: { en: null, ar: null },
                },
              ],
            })
          }
        >
          {t('design.addItem')}
        </Button>
      ) : null}
    </div>
  );
}

function MenuEditor({ s, set }: { s: SectionOf<'menu'>; set: Patch<SectionOf<'menu'>> }) {
  const { t, i18n } = useTranslation();
  const { store } = useStoreCatalog();
  return (
    <div className="flex flex-col gap-4">
      <LocalizedField
        label={t('design.title')}
        value={s.title}
        max={80}
        onChange={(v) => set({ title: v })}
      />
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['list', 'grid', 'compact'] as const)}
        onChange={(v) => set({ variant: v })}
      />
      <Toggle
        label={t('design.stickyTabs')}
        checked={s.stickyTabs}
        onChange={(v) => set({ stickyTabs: v })}
      />
      <Toggle
        label={t('design.showImages')}
        checked={s.showImages}
        onChange={(v) => set({ showImages: v })}
      />
      <Toggle
        label={t('design.showDescriptions')}
        checked={s.showDescriptions}
        onChange={(v) => set({ showDescriptions: v })}
      />
      <MultiPick
        label={t('design.chooseCategories')}
        options={(store?.categories ?? []).map((c) => ({
          id: c.id,
          label: localizedName(c, i18n.language),
        }))}
        value={s.categoryIds}
        onChange={(v) => set({ categoryIds: v })}
      />
    </div>
  );
}

function InfoEditor({ s, set }: { s: SectionOf<'info'>; set: Patch<SectionOf<'info'>> }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['strip', 'cards'] as const)}
        onChange={(v) => set({ variant: v })}
      />
      <Toggle
        label={t('design.showHours')}
        checked={s.showHours}
        onChange={(v) => set({ showHours: v })}
      />
      <Toggle
        label={t('design.showDelivery')}
        checked={s.showDelivery}
        onChange={(v) => set({ showDelivery: v })}
      />
      <Toggle
        label={t('design.showBranches')}
        checked={s.showBranches}
        onChange={(v) => set({ showBranches: v })}
      />
      <Toggle
        label={t('design.showContact')}
        checked={s.showContact}
        onChange={(v) => set({ showContact: v })}
      />
    </div>
  );
}

function CatalogEditor({ s, set }: { s: SectionOf<'catalog'>; set: Patch<SectionOf<'catalog'>> }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['grid', 'list'] as const)}
        onChange={(v) => set({ variant: v })}
      />
      {s.variant === 'grid' ? (
        <Choice
          label={t('design.columns')}
          value={s.columns}
          options={[2, 3, 4].map((n) => ({ value: n, label: String(n) }))}
          onChange={(v) => set({ columns: v })}
        />
      ) : null}
      <Toggle
        label={t('design.showSearch')}
        checked={s.showSearch}
        onChange={(v) => set({ showSearch: v })}
      />
      <Toggle
        label={t('design.showSort')}
        checked={s.showSort}
        onChange={(v) => set({ showSort: v })}
      />
      <Toggle
        label={t('design.showCategories')}
        checked={s.showCategories}
        onChange={(v) => set({ showCategories: v })}
      />
      <Toggle
        label={t('design.showFeatured')}
        checked={s.showFeatured}
        onChange={(v) => set({ showFeatured: v })}
      />
    </div>
  );
}
