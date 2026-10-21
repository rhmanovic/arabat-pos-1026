import {
  type DesignPage,
  type DesignSection,
  type DesignTemplate,
  type SectionOf,
  type SectionType,
  SECTION_TYPES,
  applySectionStyle,
  currentSectionStyle,
  sectionStyles,
  videoEmbed,
} from '@arabat/contracts';
import { Button, Field, Input, Select, cn } from '@arabat/ui';
import { localizedName } from '@arabat/web-core';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Choice,
  Group,
  ImagePicker,
  LinkPicker,
  LocalizedField,
  MultiPick,
  Panel,
  Toggle,
  useGroupOptions,
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
  countdown: '⏳',
  testimonials: '💬',
  faq: '❓',
  gallery: '🖼',
  logos: '🏷️',
  collage: '🧩',
  cta: '📣',
  spacer: '↕️',
};

/** Sections suggested first for each kind of business (ADR-0128). */
export function sectionOrder(template: DesignTemplate): SectionType[] {
  const first: SectionType[] =
    template === 'restaurant'
      ? ['menu', 'info', 'banner', 'products', 'slider', 'categories']
      : ['slider', 'products', 'categories', 'banner', 'collage', 'countdown'];
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
          : s.type === 'features' ||
              s.type === 'testimonials' ||
              s.type === 'faq' ||
              s.type === 'gallery' ||
              s.type === 'logos'
            ? t('design.items', { count: s.items.length })
            : s.type === 'collage'
              ? t('design.items', { count: s.tiles.length })
              : '';
    const look = s.look;
    const flags = [
      look.background !== 'none' ? t(`design.lookBg_${look.background}`) : '',
      look.devices !== 'all' ? t(`design.devices_${look.devices}`) : '',
      look.showFrom || look.showUntil ? `⏰ ${t('design.scheduled')}` : '',
    ];
    return [variant, extra, ...flags].filter(Boolean).join(' · ');
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
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <Panel icon="🪄" title={t('design.sectionStyles')} hint={t('design.sectionStylesHint')}>
        <StylePicker section={section} onChange={onChange} />
      </Panel>
      <Panel
        icon="✏️"
        title={t('design.sectionContent')}
        hint={t(`design.typeHint_${section.type}`)}
      >
        <SectionContent section={section} onChange={onChange} />
      </Panel>
      <Panel icon="🎨" title={t('design.sectionLook')} hint={t('design.sectionLookHint')}>
        <LookEditor section={section} onChange={onChange} />
      </Panel>
      <Panel
        icon="👁️"
        title={t('design.sectionVisibility')}
        hint={t('design.sectionVisibilityHint')}
      >
        <VisibilityEditor section={section} onChange={onChange} />
      </Panel>
    </div>
  );
}

/** Ready styles of the section's type (ADR-0128 amendment 6): its content stays as it is. */
function StylePicker({
  section,
  onChange,
}: {
  section: DesignSection;
  onChange: (next: DesignSection) => void;
}) {
  const { t } = useTranslation();
  const current = currentSectionStyle(section);
  return (
    <div
      role="radiogroup"
      aria-label={t('design.sectionStyles')}
      className="grid grid-cols-2 gap-2 sm:grid-cols-3"
    >
      {sectionStyles(section.type).map((style) => (
        <button
          key={style}
          type="button"
          role="radio"
          aria-checked={current === style}
          onClick={() => onChange(applySectionStyle(section, style))}
          className={cn(
            'flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-start text-sm font-semibold transition-colors',
            current === style
              ? 'border-primary bg-primary-soft text-primary ring-2 ring-primary/30'
              : 'border-border bg-surface hover:border-border-strong',
          )}
        >
          {t(`design.style_${style}`)}
          {current === style ? <span aria-hidden>✓</span> : null}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------- look and visibility
/** An ISO moment as the value of a `datetime-local` input (the merchant's own clock). */
export const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
export const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

function Moment({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  hint?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-end gap-2">
      <Field label={label} hint={hint} className="flex-1">
        {(p) => (
          <Input
            {...p}
            type="datetime-local"
            value={toLocalInput(value)}
            onChange={(e) => onChange(fromLocalInput(e.target.value))}
          />
        )}
      </Field>
      {value ? (
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          {t('design.clear')}
        </Button>
      ) : null}
    </div>
  );
}

function LookEditor({
  section,
  onChange,
}: {
  section: DesignSection;
  onChange: (next: DesignSection) => void;
}) {
  const { t } = useTranslation();
  const look = section.look;
  const set = (p: Partial<DesignSection['look']>) =>
    onChange({ ...section, look: { ...look, ...p } } as DesignSection);
  const opts = <T extends string>(prefix: string, values: readonly T[]) =>
    values.map((v) => ({ value: v, label: t(`design.${prefix}_${v}`) }));
  return (
    <>
      <Choice
        label={t('design.lookBackground')}
        value={look.background}
        options={opts('lookBg', ['none', 'soft', 'tinted', 'brand', 'dark'] as const)}
        onChange={(background) => set({ background })}
      />
      <Choice
        label={t('design.footerSpacing')}
        value={look.spacing}
        options={opts('spacing', ['compact', 'regular', 'roomy'] as const)}
        onChange={(spacing) => set({ spacing })}
      />
      <Choice
        label={t('design.headerWidth')}
        value={look.width}
        options={opts('width', ['contained', 'full'] as const)}
        onChange={(width) => set({ width })}
      />
      <Choice
        label={t('design.titleAlign')}
        value={look.titleAlign}
        options={opts('align', ['start', 'center'] as const)}
        onChange={(titleAlign) => set({ titleAlign })}
      />
      <LocalizedField
        label={t('design.sectionSubtitle')}
        value={look.subtitle}
        max={200}
        onChange={(subtitle) => set({ subtitle })}
      />
    </>
  );
}

function VisibilityEditor({
  section,
  onChange,
}: {
  section: DesignSection;
  onChange: (next: DesignSection) => void;
}) {
  const { t } = useTranslation();
  const look = section.look;
  const set = (p: Partial<DesignSection['look']>) =>
    onChange({ ...section, look: { ...look, ...p } } as DesignSection);
  const wrongOrder =
    look.showFrom && look.showUntil && Date.parse(look.showFrom) >= Date.parse(look.showUntil);
  return (
    <>
      <Toggle
        label={t('design.sectionShown')}
        checked={section.visible}
        onChange={(visible) => onChange({ ...section, visible } as DesignSection)}
      />
      <Choice
        label={t('design.devices')}
        value={look.devices}
        options={(['all', 'desktop', 'phone'] as const).map((v) => ({
          value: v,
          label: t(`design.devices_${v}`),
        }))}
        onChange={(devices) => set({ devices })}
      />
      <Moment
        label={t('design.showFrom')}
        value={look.showFrom}
        onChange={(showFrom) => set({ showFrom })}
      />
      <Moment
        label={t('design.showUntil')}
        value={look.showUntil}
        hint={wrongOrder ? t('design.scheduleOrder') : t('design.scheduleHint')}
        onChange={(showUntil) => set({ showUntil })}
      />
    </>
  );
}

function SectionContent({
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
    case 'countdown':
      return <CountdownEditor s={section} set={patch as Patch<SectionOf<'countdown'>>} />;
    case 'testimonials':
      return <TestimonialsEditor s={section} set={patch as Patch<SectionOf<'testimonials'>>} />;
    case 'faq':
      return <FaqEditor s={section} set={patch as Patch<SectionOf<'faq'>>} />;
    case 'gallery':
      return <GalleryEditor s={section} set={patch as Patch<SectionOf<'gallery'>>} />;
    case 'logos':
      return <LogosEditor s={section} set={patch as Patch<SectionOf<'logos'>>} />;
    case 'collage':
      return <CollageEditor s={section} set={patch as Patch<SectionOf<'collage'>>} />;
    case 'cta':
      return <CtaEditor s={section} set={patch as Patch<SectionOf<'cta'>>} />;
    case 'spacer':
      return <SpacerEditor s={section} set={patch as Patch<SectionOf<'spacer'>>} />;
  }
}

/** Repeated items (reviews, questions, pictures…): each in a group with order and remove. */
function Items<T extends { id: string }>({
  items,
  max,
  title,
  addLabel,
  make,
  onChange,
  render,
}: {
  items: T[];
  max: number;
  title: (n: number) => string;
  addLabel: string;
  make: () => T;
  onChange: (next: T[]) => void;
  render: (item: T, set: (p: Partial<T>) => void) => ReactNode;
}) {
  const { t } = useTranslation();
  const move = (i: number, by: -1 | 1) => {
    const next = [...items];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item!);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-3">
      {items.map((item, i) => (
        <Group key={item.id} title={title(i + 1)}>
          {render(item, (p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x))))}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={i === 0} onClick={() => move(i, -1)}>
              {t('design.moveUp')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={i === items.length - 1}
              onClick={() => move(i, 1)}
            >
              {t('design.moveDown')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              {t('design.removeItem')}
            </Button>
          </div>
        </Group>
      ))}
      {items.length < max ? (
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => onChange([...items, make()])}
        >
          {addLabel}
        </Button>
      ) : null}
    </div>
  );
}

const empty = () => ({ en: null, ar: null });

function CountdownEditor({
  s,
  set,
}: {
  s: SectionOf<'countdown'>;
  set: Patch<SectionOf<'countdown'>>;
}) {
  const { t } = useTranslation();
  // The moment the editor opened is close enough to say whether the offer already ended.
  const [now] = useState(() => Date.now());
  const ended = s.endsAt !== null && Date.parse(s.endsAt) <= now;
  return (
    <div className="flex flex-col gap-4">
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['banner', 'card', 'minimal'] as const)}
        onChange={(v) => set({ variant: v })}
      />
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
      <Moment
        label={t('design.endsAt')}
        value={s.endsAt}
        hint={
          s.endsAt === null
            ? t('design.endsAtHint')
            : ended
              ? t('design.countdownEnded')
              : undefined
        }
        onChange={(endsAt) => set({ endsAt })}
      />
      <div className="flex flex-wrap gap-2">
        {[1, 3, 7].map((days) => (
          <Button
            key={days}
            size="sm"
            variant="secondary"
            onClick={() => set({ endsAt: new Date(Date.now() + days * 86_400_000).toISOString() })}
          >
            {t(`design.endsIn_${days}`)}
          </Button>
        ))}
      </div>
      <LocalizedField
        label={t('design.button')}
        value={s.button}
        max={30}
        onChange={(v) => set({ button: v })}
      />
      <LinkPicker label={t('design.link')} value={s.link} onChange={(v) => set({ link: v })} />
    </div>
  );
}

function TestimonialsEditor({
  s,
  set,
}: {
  s: SectionOf<'testimonials'>;
  set: Patch<SectionOf<'testimonials'>>;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['cards', 'carousel', 'quote'] as const)}
        onChange={(v) => set({ variant: v })}
      />
      <LocalizedField
        label={t('design.title')}
        value={s.title}
        max={80}
        onChange={(v) => set({ title: v })}
      />
      <p className="rounded-lg bg-warning-soft p-3 text-xs">{t('design.reviewsHonest')}</p>
      <Items
        items={s.items}
        max={12}
        title={(n) => t('design.reviewN', { n })}
        addLabel={t('design.addReview')}
        make={() => ({
          id: newId('review'),
          name: null,
          detail: empty(),
          quote: empty(),
          rating: 5,
        })}
        onChange={(items) => set({ items })}
        render={(item, setItem) => (
          <>
            <Field label={t('design.customerName')}>
              {(p) => (
                <Input
                  {...p}
                  maxLength={60}
                  value={item.name ?? ''}
                  onChange={(e) => setItem({ name: e.target.value || null })}
                />
              )}
            </Field>
            <LocalizedField
              label={t('design.reviewDetail')}
              value={item.detail}
              max={60}
              onChange={(detail) => setItem({ detail })}
            />
            <LocalizedField
              label={t('design.reviewQuote')}
              value={item.quote}
              max={400}
              multiline
              onChange={(quote) => setItem({ quote })}
            />
            <Choice
              label={t('design.rating')}
              value={item.rating}
              options={[0, 1, 2, 3, 4, 5].map((n) => ({
                value: n,
                label: n === 0 ? t('design.noRating') : '★'.repeat(n),
              }))}
              onChange={(rating) => setItem({ rating })}
            />
          </>
        )}
      />
    </div>
  );
}

function FaqEditor({ s, set }: { s: SectionOf<'faq'>; set: Patch<SectionOf<'faq'>> }) {
  const { t } = useTranslation();
  const unanswered = s.items.filter(
    (i) => (i.question.ar || i.question.en) && !i.answer.ar && !i.answer.en,
  ).length;
  return (
    <div className="flex flex-col gap-4">
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['accordion', 'columns'] as const)}
        onChange={(v) => set({ variant: v })}
      />
      <LocalizedField
        label={t('design.title')}
        value={s.title}
        max={80}
        onChange={(v) => set({ title: v })}
      />
      {unanswered > 0 ? (
        <p className="rounded-lg bg-warning-soft p-3 text-xs">
          {t('design.unanswered', { count: unanswered })}
        </p>
      ) : null}
      <Items
        items={s.items}
        max={15}
        title={(n) => t('design.questionN', { n })}
        addLabel={t('design.addQuestion')}
        make={() => ({ id: newId('q'), question: empty(), answer: empty() })}
        onChange={(items) => set({ items })}
        render={(item, setItem) => (
          <>
            <LocalizedField
              label={t('design.question')}
              value={item.question}
              max={160}
              onChange={(question) => setItem({ question })}
            />
            <LocalizedField
              label={t('design.answer')}
              value={item.answer}
              max={1000}
              multiline
              onChange={(answer) => setItem({ answer })}
            />
          </>
        )}
      />
    </div>
  );
}

function GalleryEditor({ s, set }: { s: SectionOf<'gallery'>; set: Patch<SectionOf<'gallery'>> }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['grid', 'carousel', 'mosaic'] as const)}
        onChange={(v) => set({ variant: v })}
      />
      <LocalizedField
        label={t('design.title')}
        value={s.title}
        max={80}
        onChange={(v) => set({ title: v })}
      />
      {s.variant === 'grid' ? (
        <Choice
          label={t('design.columns')}
          value={s.columns}
          options={[2, 3, 4].map((n) => ({ value: n, label: String(n) }))}
          onChange={(v) => set({ columns: v })}
        />
      ) : null}
      <Items
        items={s.items}
        max={12}
        title={(n) => t('design.pictureN', { n })}
        addLabel={t('design.addPicture')}
        make={() => ({ id: newId('pic'), imageId: null, caption: empty(), link: null })}
        onChange={(items) => set({ items })}
        render={(item, setItem) => (
          <>
            <ImagePicker
              label={t('design.image')}
              value={item.imageId}
              onChange={(imageId) => setItem({ imageId })}
            />
            <LocalizedField
              label={t('design.caption')}
              value={item.caption}
              max={80}
              onChange={(caption) => setItem({ caption })}
            />
            <LinkPicker
              label={t('design.link')}
              value={item.link}
              onChange={(link) => setItem({ link })}
            />
          </>
        )}
      />
    </div>
  );
}

function LogosEditor({ s, set }: { s: SectionOf<'logos'>; set: Patch<SectionOf<'logos'>> }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['row', 'grid'] as const)}
        onChange={(v) => set({ variant: v })}
      />
      <LocalizedField
        label={t('design.title')}
        value={s.title}
        max={80}
        onChange={(v) => set({ title: v })}
      />
      <Toggle
        label={t('design.grayscale')}
        checked={s.grayscale}
        onChange={(grayscale) => set({ grayscale })}
      />
      <Items
        items={s.items}
        max={16}
        title={(n) => t('design.logoN', { n })}
        addLabel={t('design.addLogo')}
        make={() => ({ id: newId('logo'), imageId: null, alt: empty(), link: null })}
        onChange={(items) => set({ items })}
        render={(item, setItem) => (
          <>
            <ImagePicker
              label={t('design.image')}
              value={item.imageId}
              onChange={(imageId) => setItem({ imageId })}
            />
            <LocalizedField
              label={t('design.brandName')}
              value={item.alt}
              max={60}
              onChange={(alt) => setItem({ alt })}
            />
            <LinkPicker
              label={t('design.link')}
              value={item.link}
              onChange={(link) => setItem({ link })}
            />
          </>
        )}
      />
    </div>
  );
}

function CollageEditor({ s, set }: { s: SectionOf<'collage'>; set: Patch<SectionOf<'collage'>> }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['mosaic', 'even'] as const)}
        onChange={(v) => set({ variant: v })}
      />
      <Items
        items={s.tiles}
        max={4}
        title={(n) => t('design.tileN', { n })}
        addLabel={t('design.addTile')}
        make={() => ({
          id: newId('tile'),
          imageId: null,
          title: empty(),
          subtitle: empty(),
          button: empty(),
          link: null,
        })}
        onChange={(tiles) => set({ tiles })}
        render={(tile, setTile) => (
          <>
            <ImagePicker
              label={t('design.image')}
              value={tile.imageId}
              onChange={(imageId) => setTile({ imageId })}
            />
            <LocalizedField
              label={t('design.title')}
              value={tile.title}
              max={60}
              onChange={(title) => setTile({ title })}
            />
            <LocalizedField
              label={t('design.subtitle')}
              value={tile.subtitle}
              max={120}
              onChange={(subtitle) => setTile({ subtitle })}
            />
            <LocalizedField
              label={t('design.button')}
              value={tile.button}
              max={30}
              onChange={(button) => setTile({ button })}
            />
            <LinkPicker
              label={t('design.link')}
              value={tile.link}
              onChange={(link) => setTile({ link })}
            />
          </>
        )}
      />
    </div>
  );
}

function CtaEditor({ s, set }: { s: SectionOf<'cta'>; set: Patch<SectionOf<'cta'>> }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['brand', 'soft', 'outline', 'image'] as const)}
        onChange={(v) => set({ variant: v })}
      />
      {s.variant === 'image' ? (
        <ImagePicker
          label={t('design.image')}
          value={s.imageId}
          onChange={(imageId) => set({ imageId })}
        />
      ) : null}
      <LocalizedField
        label={t('design.title')}
        value={s.title}
        max={80}
        onChange={(v) => set({ title: v })}
      />
      <LocalizedField
        label={t('design.text')}
        value={s.text}
        max={240}
        onChange={(v) => set({ text: v })}
      />
      <LocalizedField
        label={t('design.button')}
        value={s.button}
        max={30}
        onChange={(v) => set({ button: v })}
      />
      <LinkPicker label={t('design.link')} value={s.link} onChange={(v) => set({ link: v })} />
      <LocalizedField
        label={t('design.button2')}
        value={s.button2}
        max={30}
        onChange={(v) => set({ button2: v })}
      />
      <LinkPicker label={t('design.link2')} value={s.link2} onChange={(v) => set({ link2: v })} />
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

function SpacerEditor({ s, set }: { s: SectionOf<'spacer'>; set: Patch<SectionOf<'spacer'>> }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <Choice
        label={t('design.spacerSize')}
        value={s.size}
        options={(['small', 'medium', 'large'] as const).map((v) => ({
          value: v,
          label: t(`design.size_${v}`),
        }))}
        onChange={(size) => set({ size })}
      />
      <Toggle label={t('design.spacerLine')} checked={s.line} onChange={(line) => set({ line })} />
    </div>
  );
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
      {s.autoplay ? (
        <Choice
          label={t('design.interval')}
          value={s.interval}
          options={([3, 5, 8] as const).map((n) => ({
            value: n,
            label: t('design.seconds', { count: n }),
          }))}
          onChange={(interval) => set({ interval })}
        />
      ) : null}
      <Choice
        label={t('design.height')}
        value={s.height}
        options={(['small', 'medium', 'large'] as const).map((v) => ({
          value: v,
          label: t(`design.size_${v}`),
        }))}
        onChange={(height) => set({ height })}
      />
      <Choice
        label={t('design.overlay')}
        value={s.overlay}
        options={(['none', 'light', 'dark'] as const).map((v) => ({
          value: v,
          label: t(`design.overlay_${v}`),
        }))}
        onChange={(overlay) => set({ overlay })}
      />
      <Choice
        label={t('design.align')}
        value={s.textAlign}
        options={[
          { value: 'start', label: t('design.align_start') },
          { value: 'center', label: t('design.align_center') },
        ]}
        onChange={(textAlign) => set({ textAlign })}
      />
      <Toggle
        label={t('design.showArrows')}
        checked={s.showArrows}
        onChange={(showArrows) => set({ showArrows })}
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
      <LocalizedField
        label={t('design.button2')}
        value={s.button2}
        max={30}
        onChange={(v) => set({ button2: v })}
      />
      <LinkPicker label={t('design.link2')} value={s.link2} onChange={(v) => set({ link2: v })} />
      <Choice
        label={t('design.align')}
        value={s.align}
        options={[
          { value: 'start', label: t('design.align_start') },
          { value: 'center', label: t('design.align_center') },
        ]}
        onChange={(v) => set({ align: v })}
      />
      {s.variant === 'overlay' ? (
        <>
          <Choice
            label={t('design.height')}
            value={s.height}
            options={(['small', 'medium', 'large'] as const).map((v) => ({
              value: v,
              label: t(`design.size_${v}`),
            }))}
            onChange={(height) => set({ height })}
          />
          <Choice
            label={t('design.overlay')}
            value={s.overlay}
            options={(['none', 'light', 'dark'] as const).map((v) => ({
              value: v,
              label: t(`design.overlay_${v}`),
            }))}
            onChange={(overlay) => set({ overlay })}
          />
        </>
      ) : null}
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
  const { products } = useStoreCatalog();
  const groups = useGroupOptions();
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
              {groups.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
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
      <Choice
        label={t('design.sortBy')}
        value={s.sort}
        options={(['position', 'name', 'priceAsc', 'priceDesc'] as const).map((v) => ({
          value: v,
          label: t(`design.sort_${v}`),
        }))}
        onChange={(sort) => set({ sort })}
      />
      <Toggle
        label={t('design.showAdd')}
        checked={s.showAdd}
        onChange={(showAdd) => set({ showAdd })}
      />
      <Toggle
        label={t('design.showViewAll')}
        checked={s.showViewAll}
        onChange={(showViewAll) => set({ showViewAll })}
      />
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
  const { t } = useTranslation();
  const groups = useGroupOptions();
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
        options={useVariants(['tiles', 'cards', 'circles', 'banners', 'chips', 'list'] as const)}
        onChange={(v) => set({ variant: v })}
      />
      <MultiPick
        label={t('design.chooseCategories')}
        options={groups}
        value={s.categoryIds}
        onChange={(v) => set({ categoryIds: v })}
      />
      {s.variant === 'tiles' || s.variant === 'cards' ? (
        <>
          <Choice
            label={t('design.columns')}
            value={s.columns}
            options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))}
            onChange={(columns) => set({ columns })}
          />
          <Choice
            label={t('design.mobileColumns')}
            value={s.mobileColumns}
            options={([1, 2, 3] as const).map((n) => ({ value: n, label: String(n) }))}
            onChange={(mobileColumns) => set({ mobileColumns })}
          />
          <Choice
            label={t('design.pictureShape')}
            value={s.aspect}
            options={(['landscape', 'square', 'portrait'] as const).map((v) => ({
              value: v,
              label: t(`design.pictureShape_${v}`),
            }))}
            onChange={(aspect) => set({ aspect })}
          />
        </>
      ) : null}
      <Toggle
        label={t('design.showCount')}
        checked={s.showCount}
        onChange={(showCount) => set({ showCount })}
      />
      {s.categoryIds.length === 0 ? (
        <Toggle
          label={t('design.topOnly')}
          checked={s.topOnly}
          onChange={(topOnly) => set({ topOnly })}
        />
      ) : null}
      {s.variant === 'tiles' || s.variant === 'cards' || s.variant === 'list' ? (
        <Toggle
          label={t('design.showSub')}
          checked={s.showSub}
          onChange={(showSub) => set({ showSub })}
        />
      ) : null}
      <Toggle
        label={t('design.showViewAll')}
        checked={s.showViewAll}
        onChange={(showViewAll) => set({ showViewAll })}
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
      <LocalizedField
        label={t('design.button')}
        value={s.button}
        max={30}
        onChange={(v) => set({ button: v })}
      />
      <LinkPicker label={t('design.link')} value={s.link} onChange={(v) => set({ link: v })} />
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
      <LocalizedField
        label={t('design.title')}
        value={s.title}
        max={80}
        onChange={(v) => set({ title: v })}
      />
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
  const { t } = useTranslation();
  const groups = useGroupOptions();
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
        options={groups}
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
