import {
  type DesignPage,
  type DesignSection,
  type DesignTemplate,
  type SectionOf,
  type SectionLook,
  type SectionType,
  OWN_TITLE_SECTIONS,
  SECTION_ANIMATIONS,
  SECTION_GRADIENTS,
  SECTION_TYPES,
  SHAPE_DIVIDERS,
  applySectionStyle,
  currentSectionStyle,
  sectionStyles,
  videoEmbed,
} from '@arabat/contracts';
import { Button, Field, Input, Select, cn } from '@arabat/ui';
import { localizedName } from '@arabat/web-core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Choice,
  Group,
  ImagePicker,
  LinkPicker,
  LocalizedField,
  Items,
  MultiPick,
  Panel,
  Toggle,
  empty,
  useOpts,
  useVariants,
  useGroupOptions,
  useStoreCatalog,
} from './fields.js';
import {
  CardsEditor,
  ColumnsEditor,
  DividerEditor,
  MarqueeEditor,
  SplitEditor,
  StatsEditor,
  StepsEditor,
  TabsEditor,
} from './LayoutEditors.js';

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
  divider: '➖',
  columns: '🧱',
  split: '🌓',
  cards: '🃏',
  tabs: '🗂',
  marquee: '🎢',
  stats: '🔢',
  steps: '🪜',
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
              s.type === 'logos' ||
              s.type === 'cards' ||
              s.type === 'marquee' ||
              s.type === 'stats' ||
              s.type === 'steps'
            ? t('design.items', { count: s.items.length })
            : s.type === 'collage'
              ? t('design.items', { count: s.tiles.length })
              : s.type === 'tabs'
                ? t('design.items', { count: s.tabs.length })
                : s.type === 'columns'
                  ? t(`design.layout_${s.layout}`)
                  : '';
    const look = s.look;
    const flags = [
      look.background !== 'none' ? t(`design.lookBg_${look.background}`) : '',
      look.devices !== 'all' ? t(`design.devices_${look.devices}`) : '',
      look.animation !== 'none' ? `✨ ${t(`design.animation_${look.animation}`)}` : '',
      look.anchor ? `#${look.anchor}` : '',
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
  const coloured = look.background !== 'none';
  return (
    <>
      <Group title={t('design.lookGroup_background')}>
        <Choice
          label={t('design.lookBackground')}
          value={look.background}
          options={opts('lookBg', [
            'none',
            'soft',
            'tinted',
            'brand',
            'dark',
            'gradient',
            'image',
            'custom',
          ] as const)}
          onChange={(background) => set({ background })}
        />
        {look.background === 'gradient' ? (
          <GradientPicker value={look.gradient} onChange={(gradient) => set({ gradient })} />
        ) : null}
        {look.background === 'custom' ? (
          <ColourField
            label={t('design.bgColor')}
            value={look.bgColor}
            onChange={(bgColor) => set({ bgColor })}
          />
        ) : null}
        {look.background === 'image' ? (
          <>
            <ImagePicker
              label={t('design.bgImage')}
              value={look.bgImageId}
              onChange={(bgImageId) => set({ bgImageId })}
            />
            <Choice
              label={t('design.overlay')}
              value={look.bgOverlay}
              options={opts('overlay', ['none', 'light', 'dark'] as const)}
              onChange={(bgOverlay) => set({ bgOverlay })}
            />
          </>
        ) : null}
        {coloured ? (
          <>
            <Choice
              label={t('design.corners')}
              value={look.corners}
              options={opts('corners', ['none', 'soft', 'round'] as const)}
              onChange={(corners) => set({ corners })}
            />
            <Choice
              label={t('design.dividerTop')}
              value={look.dividerTop}
              options={opts('shape', SHAPE_DIVIDERS)}
              onChange={(dividerTop) => set({ dividerTop })}
            />
            <Choice
              label={t('design.dividerBottom')}
              value={look.dividerBottom}
              options={opts('shape', SHAPE_DIVIDERS)}
              onChange={(dividerBottom) => set({ dividerBottom })}
            />
          </>
        ) : (
          <p className="text-xs text-fg-muted">{t('design.edgesHint')}</p>
        )}
      </Group>
      <Group title={t('design.lookGroup_size')}>
        <Choice
          label={t('design.footerSpacing')}
          value={look.spacing}
          options={opts('spacing', ['none', 'compact', 'regular', 'roomy', 'huge'] as const)}
          onChange={(spacing) => set({ spacing })}
        />
        <Choice
          label={t('design.headerWidth')}
          value={look.width}
          options={opts('width', ['narrow', 'contained', 'full'] as const)}
          onChange={(width) => set({ width })}
        />
        <Choice
          label={t('design.sectionHeight')}
          value={look.height}
          options={opts('height', ['auto', 'half', 'screen'] as const)}
          onChange={(height) => set({ height })}
        />
        <Toggle
          label={t('design.boxed')}
          checked={look.boxed}
          onChange={(boxed) => set({ boxed })}
        />
      </Group>
      <Group title={t('design.lookGroup_heading')}>
        {OWN_TITLE_SECTIONS.includes(section.type) ? (
          <p className="text-xs text-fg-muted">{t('design.headingInContent')}</p>
        ) : (
          <LocalizedField
            label={t('design.sectionHeading')}
            value={look.heading}
            max={120}
            onChange={(heading) => set({ heading })}
          />
        )}
        <Choice
          label={t('design.titleAlign')}
          value={look.titleAlign}
          options={opts('align', ['start', 'center'] as const)}
          onChange={(titleAlign) => set({ titleAlign })}
        />
        <Choice
          label={t('design.titleColor')}
          value={look.titleColor}
          options={opts('titleColor', ['default', 'brand'] as const)}
          onChange={(titleColor) => set({ titleColor })}
        />
        <Choice
          label={t('design.titleSize')}
          value={look.titleSize}
          options={opts('titleSize', ['small', 'regular', 'large', 'huge'] as const)}
          onChange={(titleSize) => set({ titleSize })}
        />
        <LocalizedField
          label={t('design.eyebrow')}
          value={look.eyebrow}
          max={60}
          onChange={(eyebrow) => set({ eyebrow })}
        />
        <LocalizedField
          label={t('design.sectionSubtitle')}
          value={look.subtitle}
          max={200}
          onChange={(subtitle) => set({ subtitle })}
        />
      </Group>
      <Group title={t('design.lookGroup_motion')}>
        <Choice
          label={t('design.animation')}
          value={look.animation}
          options={opts('animation', SECTION_ANIMATIONS)}
          onChange={(animation) => set({ animation })}
        />
        <Toggle
          label={t('design.sticky')}
          checked={look.sticky}
          onChange={(sticky) => set({ sticky })}
        />
        <Toggle
          label={t('design.overlap')}
          checked={look.overlap}
          onChange={(overlap) => set({ overlap })}
        />
        <Toggle
          label={t('design.collapsible')}
          checked={look.collapsible}
          onChange={(collapsible) => set({ collapsible })}
        />
        {look.collapsible ? (
          <LocalizedField
            label={t('design.collapseLabel')}
            value={look.collapseLabel}
            max={80}
            onChange={(collapseLabel) => set({ collapseLabel })}
          />
        ) : null}
        <Field
          label={t('design.anchor')}
          hint={
            look.anchor ? t('design.anchorLink', { anchor: look.anchor }) : t('design.anchorHint')
          }
        >
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              maxLength={40}
              value={look.anchor}
              onChange={(e) =>
                set({
                  anchor: e.target.value
                    .toLowerCase()
                    .replace(/\s+/g, '-')
                    .replace(/[^a-z0-9-]/g, ''),
                })
              }
            />
          )}
        </Field>
      </Group>
    </>
  );
}

/** The ready gradients as swatches. */
function GradientPicker({
  value,
  onChange,
}: {
  value: SectionLook['gradient'];
  onChange: (v: SectionLook['gradient']) => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="radiogroup" aria-label={t('design.gradient')} className="flex flex-wrap gap-2">
      {SECTION_GRADIENTS.map((g) => (
        <button
          key={g}
          type="button"
          role="radio"
          aria-checked={value === g}
          aria-label={t(`design.gradient_${g}`)}
          title={t(`design.gradient_${g}`)}
          onClick={() => onChange(g)}
          className={cn(
            'size-10 rounded-full border-2 transition',
            value === g ? 'border-fg ring-2 ring-primary/40' : 'border-transparent',
          )}
          style={{ backgroundImage: GRADIENT_PREVIEW[g] }}
        />
      ))}
    </div>
  );
}
const GRADIENT_PREVIEW: Record<SectionLook['gradient'], string> = {
  brand:
    'linear-gradient(135deg, var(--color-primary), color-mix(in oklch, var(--color-primary) 55%, black))',
  sunset: 'linear-gradient(135deg, #f97316, #db2777)',
  ocean: 'linear-gradient(135deg, #0284c7, #4338ca)',
  candy: 'linear-gradient(135deg, #fbcfe8, #ddd6fe)',
  mint: 'linear-gradient(135deg, #a7f3d0, #a5f3fc)',
  night: 'linear-gradient(135deg, #0f172a, #4c1d95)',
  peach: 'linear-gradient(135deg, #fde68a, #fca5a5)',
  aurora: 'linear-gradient(120deg, #0e7490, #7e22ce 55%, #be185d)',
};

/** A colour picker with its `#rrggbb` value. */
export function ColourField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <Field label={label}>
      {(p) => (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={label}
            value={value ?? '#7c3aed'}
            onChange={(e) => onChange(e.target.value)}
            className="h-10 w-14 cursor-pointer rounded-md border border-border bg-surface"
          />
          <Input
            {...p}
            dir="ltr"
            className="w-32"
            maxLength={7}
            value={value ?? ''}
            placeholder="#7c3aed"
            onChange={(e) => onChange(e.target.value || null)}
          />
        </div>
      )}
    </Field>
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
    case 'divider':
      return <DividerEditor s={section} set={patch as Patch<SectionOf<'divider'>>} />;
    case 'columns':
      return <ColumnsEditor s={section} set={patch as Patch<SectionOf<'columns'>>} />;
    case 'split':
      return <SplitEditor s={section} set={patch as Patch<SectionOf<'split'>>} />;
    case 'cards':
      return <CardsEditor s={section} set={patch as Patch<SectionOf<'cards'>>} />;
    case 'tabs':
      return <TabsEditor s={section} set={patch as Patch<SectionOf<'tabs'>>} />;
    case 'marquee':
      return <MarqueeEditor s={section} set={patch as Patch<SectionOf<'marquee'>>} />;
    case 'stats':
      return <StatsEditor s={section} set={patch as Patch<SectionOf<'stats'>>} />;
    case 'steps':
      return <StepsEditor s={section} set={patch as Patch<SectionOf<'steps'>>} />;
  }
}

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
        options={useVariants(['grid', 'masonry', 'carousel', 'mosaic'] as const)}
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
  const opts = useOpts();
  return (
    <div className="flex flex-col gap-4">
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['brand', 'soft', 'outline', 'image'] as const)}
        onChange={(v) => set({ variant: v })}
      />
      <LocalizedField
        label={t('design.eyebrow')}
        value={s.eyebrow}
        max={60}
        onChange={(eyebrow) => set({ eyebrow })}
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
      <Choice
        label={t('design.ctaSize')}
        value={s.size}
        options={opts('ctaSize', ['compact', 'regular', 'large'] as const)}
        onChange={(size) => set({ size })}
      />
      <Choice
        label={t('design.ctaLayout')}
        value={s.layout}
        options={opts('ctaLayout', ['stacked', 'inline'] as const)}
        onChange={(layout) => set({ layout })}
      />
      <Choice
        label={t('design.buttonStyle')}
        value={s.buttonStyle}
        options={opts('buttonStyle', ['solid', 'outline', 'pill', 'glass'] as const)}
        onChange={(buttonStyle) => set({ buttonStyle })}
      />
      <Choice
        label={t('design.corners')}
        value={s.rounded}
        options={opts('corners', ['none', 'soft', 'round'] as const)}
        onChange={(rounded) => set({ rounded })}
      />
      <Toggle label={t('design.pulse')} checked={s.pulse} onChange={(pulse) => set({ pulse })} />
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
        options={(['small', 'medium', 'large', 'huge'] as const).map((v) => ({
          value: v,
          label: t(`design.size_${v}`),
        }))}
        onChange={(size) => set({ size })}
      />
      <Toggle label={t('design.spacerLine')} checked={s.line} onChange={(line) => set({ line })} />
    </div>
  );
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
  const opts = useOpts();
  return (
    <div className="flex flex-col gap-4">
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['overlay', 'card', 'glass', 'split', 'color'] as const)}
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
        <>
          <ImagePicker
            label={t('design.image')}
            value={s.imageId}
            onChange={(v) => set({ imageId: v })}
          />
          <ImagePicker
            label={t('design.mobileImage')}
            value={s.mobileImageId}
            onChange={(v) => set({ mobileImageId: v })}
          />
        </>
      ) : null}
      <LocalizedField
        label={t('design.eyebrow')}
        value={s.eyebrow}
        max={60}
        onChange={(v) => set({ eyebrow: v })}
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
        options={opts('align', ['start', 'center', 'end'] as const)}
        onChange={(v) => set({ align: v })}
      />
      <Choice
        label={t('design.titleSize')}
        value={s.titleSize}
        options={opts('titleSize', ['regular', 'large', 'huge'] as const)}
        onChange={(titleSize) => set({ titleSize })}
      />
      <Choice
        label={t('design.buttonStyle')}
        value={s.buttonStyle}
        options={opts('buttonStyle', ['solid', 'outline', 'pill', 'glass'] as const)}
        onChange={(buttonStyle) => set({ buttonStyle })}
      />
      <Choice
        label={t('design.corners')}
        value={s.rounded}
        options={opts('corners', ['none', 'soft', 'round'] as const)}
        onChange={(rounded) => set({ rounded })}
      />
      {s.variant === 'overlay' || s.variant === 'card' || s.variant === 'glass' ? (
        <>
          <Choice
            label={t('design.height')}
            value={s.height}
            options={opts('size', ['small', 'medium', 'large', 'screen'] as const)}
            onChange={(height) => set({ height })}
          />
          <Choice
            label={t('design.position')}
            value={s.position}
            options={opts('position', ['top', 'center', 'bottom'] as const)}
            onChange={(position) => set({ position })}
          />
          <Choice
            label={t('design.overlay')}
            value={s.overlay}
            options={opts('overlay', ['none', 'light', 'medium', 'dark', 'gradient'] as const)}
            onChange={(overlay) => set({ overlay })}
          />
          <Toggle label={t('design.zoom')} checked={s.zoom} onChange={(zoom) => set({ zoom })} />
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
          options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))}
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
      {s.variant !== 'list' ? <CardLookFields s={s} set={set} /> : null}
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
  const opts = useOpts();
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
        options={useVariants([
          'tiles',
          'cards',
          'carousel',
          'circles',
          'banners',
          'chips',
          'list',
        ] as const)}
        onChange={(v) => set({ variant: v })}
      />
      <MultiPick
        label={t('design.chooseCategories')}
        options={groups}
        value={s.categoryIds}
        onChange={(v) => set({ categoryIds: v })}
      />
      {s.variant === 'tiles' || s.variant === 'carousel' ? (
        <Choice
          label={t('design.labelPosition')}
          value={s.labelPosition}
          options={opts('labelPosition', ['overlay', 'below'] as const)}
          onChange={(labelPosition) => set({ labelPosition })}
        />
      ) : null}
      {s.variant === 'tiles' || s.variant === 'cards' || s.variant === 'carousel' ? (
        <Choice
          label={t('design.hover')}
          value={s.hover}
          options={opts('hover', ['none', 'zoom', 'lift'] as const)}
          onChange={(hover) => set({ hover })}
        />
      ) : null}
      {s.variant === 'carousel' ? (
        <Choice
          label={t('design.pictureShape')}
          value={s.aspect}
          options={(['landscape', 'square', 'portrait'] as const).map((v) => ({
            value: v,
            label: t(`design.pictureShape_${v}`),
          }))}
          onChange={(aspect) => set({ aspect })}
        />
      ) : null}
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
  const opts = useOpts();
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
        options={useVariants(['row', 'grid', 'cards', 'list'] as const)}
        onChange={(v) => set({ variant: v })}
      />
      {s.variant === 'grid' || s.variant === 'cards' ? (
        <Choice
          label={t('design.columns')}
          value={s.columns}
          options={([0, 2, 3, 4] as const).map((n) => ({
            value: n,
            label: n === 0 ? t('design.columns_auto') : String(n),
          }))}
          onChange={(columns) => set({ columns })}
        />
      ) : null}
      <Choice
        label={t('design.iconStyle')}
        value={s.iconStyle}
        options={opts('iconStyle', ['circle', 'square', 'outline', 'plain'] as const)}
        onChange={(iconStyle) => set({ iconStyle })}
      />
      <Choice
        label={t('design.iconSize')}
        value={s.iconSize}
        options={opts('iconSize', ['small', 'regular', 'large'] as const)}
        onChange={(iconSize) => set({ iconSize })}
      />
      <Choice
        label={t('design.align')}
        value={s.align}
        options={opts('align', ['auto', 'start', 'center'] as const)}
        onChange={(align) => set({ align })}
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
          <LinkPicker
            label={t('design.link')}
            value={item.link}
            onChange={(link) => setItem(i, { link })}
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
                  link: null,
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
  const opts = useOpts();
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
          options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))}
          onChange={(v) => set({ columns: v })}
        />
      ) : null}
      {s.variant === 'grid' ? <CardLookFields s={s} set={set} /> : null}
      <Toggle
        label={t('design.showAdd')}
        checked={s.showAdd}
        onChange={(showAdd) => set({ showAdd })}
      />
      <Group title={t('design.catalogFilters')}>
        <Toggle
          label={t('design.showSearch')}
          checked={s.showSearch}
          onChange={(v) => set({ showSearch: v })}
        />
        {s.showSearch ? (
          <LocalizedField
            label={t('design.searchPlaceholder')}
            value={s.searchPlaceholder}
            max={60}
            onChange={(searchPlaceholder) => set({ searchPlaceholder })}
          />
        ) : null}
        <Toggle
          label={t('design.showSort')}
          checked={s.showSort}
          onChange={(v) => set({ showSort: v })}
        />
        <Choice
          label={t('design.defaultSort')}
          value={s.defaultSort}
          options={opts('defaultSort', ['default', 'name', 'priceAsc', 'priceDesc'] as const)}
          onChange={(defaultSort) => set({ defaultSort })}
        />
        <Toggle
          label={t('design.showCategories')}
          checked={s.showCategories}
          onChange={(v) => set({ showCategories: v })}
        />
        {s.showCategories ? (
          <Choice
            label={t('design.filterStyle')}
            value={s.filterStyle}
            options={opts('filterStyle', ['chips', 'tabs', 'dropdown'] as const)}
            onChange={(filterStyle) => set({ filterStyle })}
          />
        ) : null}
        <Toggle
          label={t('design.stickyFilters')}
          checked={s.stickyFilters}
          onChange={(stickyFilters) => set({ stickyFilters })}
        />
      </Group>
      <Group title={t('design.barLook')}>
        <Choice
          label={t('design.barLayout')}
          value={s.barLayout}
          options={opts('barLayout', ['row', 'stacked'] as const)}
          onChange={(barLayout) => set({ barLayout })}
        />
        <Choice
          label={t('design.barStyle')}
          value={s.barStyle}
          options={opts('barStyle', ['plain', 'card', 'soft'] as const)}
          onChange={(barStyle) => set({ barStyle })}
        />
        <Choice
          label={t('design.align')}
          value={s.barAlign}
          options={opts('align', ['start', 'center'] as const)}
          onChange={(barAlign) => set({ barAlign })}
        />
        <Choice
          label={t('design.controlSize')}
          value={s.controlSize}
          options={opts('blockSize', ['small', 'regular', 'large'] as const)}
          onChange={(controlSize) => set({ controlSize })}
        />
        {s.showSearch ? (
          <>
            <Choice
              label={t('design.searchBox')}
              value={s.searchStyle}
              options={opts('searchBox', ['outline', 'filled', 'pill', 'underline'] as const)}
              onChange={(searchStyle) => set({ searchStyle })}
            />
            <Choice
              label={t('design.searchWidth')}
              value={s.searchWidth}
              options={opts('searchWidth', ['auto', 'full'] as const)}
              onChange={(searchWidth) => set({ searchWidth })}
            />
            <Toggle
              label={t('design.searchIcon')}
              checked={s.searchIcon}
              onChange={(searchIcon) => set({ searchIcon })}
            />
          </>
        ) : null}
        {s.showSort ? (
          <Choice
            label={t('design.sortStyle')}
            value={s.sortStyle}
            options={opts('sortStyle', ['select', 'pills'] as const)}
            onChange={(sortStyle) => set({ sortStyle })}
          />
        ) : null}
        {s.showCategories && s.filterStyle === 'chips' ? (
          <>
            <Choice
              label={t('design.chipShape')}
              value={s.chipShape}
              options={opts('chipShape', ['pill', 'rounded', 'square'] as const)}
              onChange={(chipShape) => set({ chipShape })}
            />
            <Choice
              label={t('design.chipActive')}
              value={s.chipActive}
              options={opts('chipActive', ['solid', 'outline', 'soft'] as const)}
              onChange={(chipActive) => set({ chipActive })}
            />
            <Toggle
              label={t('design.chipImages')}
              checked={s.chipImages}
              onChange={(chipImages) => set({ chipImages })}
            />
            <Toggle
              label={t('design.chipScroll')}
              checked={s.chipScroll}
              onChange={(chipScroll) => set({ chipScroll })}
            />
          </>
        ) : null}
      </Group>
      <Toggle
        label={t('design.showFeatured')}
        checked={s.showFeatured}
        onChange={(v) => set({ showFeatured: v })}
      />
      <Toggle
        label={t('design.showProductCount')}
        checked={s.showCount}
        onChange={(showCount) => set({ showCount })}
      />
      <Choice
        label={t('design.pageSize')}
        value={s.pageSize}
        options={([0, 12, 24, 48] as const).map((n) => ({
          value: n,
          label: n === 0 ? t('design.pageSize_all') : String(n),
        }))}
        onChange={(pageSize) => set({ pageSize })}
      />
    </div>
  );
}

type CardLook = Pick<
  SectionOf<'products'>,
  | 'cardStyle'
  | 'aspect'
  | 'mobileColumns'
  | 'hoverImage'
  | 'imageFit'
  | 'showCategory'
  | 'nameLines'
  | 'priceSize'
  | 'textAlign'
  | 'buyButton'
  | 'buyLabel'
  | 'buyColor'
  | 'soldOut'
>;
/** How the product cards of a list look (products and catalog sections). */
function CardLookFields({ s, set }: { s: CardLook; set: (p: Partial<CardLook>) => void }) {
  const { t } = useTranslation();
  const opts = useOpts();
  return (
    <Group title={t('design.productCards')}>
      <Choice
        label={t('design.cardStyle')}
        value={s.cardStyle}
        options={opts('cardStyle', [
          'default',
          'minimal',
          'bordered',
          'soft',
          'divided',
          'overlay',
        ] as const)}
        onChange={(cardStyle) => set({ cardStyle })}
      />
      <Choice
        label={t('design.imageFit')}
        value={s.imageFit}
        options={opts('imageFit', ['cover', 'contain'] as const)}
        onChange={(imageFit) => set({ imageFit })}
      />
      <Choice
        label={t('design.pictureShape')}
        value={s.aspect}
        options={opts('pictureShape', ['square', 'portrait', 'landscape'] as const)}
        onChange={(aspect) => set({ aspect })}
      />
      <Choice
        label={t('design.mobileColumns')}
        value={s.mobileColumns}
        options={([1, 2] as const).map((n) => ({ value: n, label: String(n) }))}
        onChange={(mobileColumns) => set({ mobileColumns })}
      />
      <Toggle
        label={t('design.hoverImage')}
        checked={s.hoverImage}
        onChange={(hoverImage) => set({ hoverImage })}
      />
      <Choice
        label={t('design.align')}
        value={s.textAlign}
        options={opts('align', ['start', 'center'] as const)}
        onChange={(textAlign) => set({ textAlign })}
      />
      <Toggle
        label={t('design.showCategoryLine')}
        checked={s.showCategory}
        onChange={(showCategory) => set({ showCategory })}
      />
      <Choice
        label={t('design.nameLines')}
        value={s.nameLines}
        options={opts('nameLines', ['full', '1', '2'] as const)}
        onChange={(nameLines) => set({ nameLines })}
      />
      <Choice
        label={t('design.cardPrice')}
        value={s.priceSize}
        options={opts('cardPrice', ['regular', 'large'] as const)}
        onChange={(priceSize) => set({ priceSize })}
      />
      <Choice
        label={t('design.soldOutStyle')}
        value={s.soldOut}
        options={opts('soldOutStyle', ['text', 'corner'] as const)}
        onChange={(soldOut) => set({ soldOut })}
      />
      <Choice
        label={t('design.buyButton')}
        value={s.buyButton}
        options={opts('buyButton', ['none', 'inline', 'full'] as const)}
        onChange={(buyButton) => set({ buyButton })}
      />
      {s.buyButton !== 'none' ? (
        <>
          <LocalizedField
            label={t('design.buyLabel')}
            value={s.buyLabel}
            max={30}
            onChange={(buyLabel) => set({ buyLabel })}
          />
          <ColourField
            label={t('design.buyColor')}
            value={s.buyColor}
            onChange={(buyColor) => set({ buyColor })}
          />
          <p className="text-xs text-fg-muted">{t('design.buyButtonHint')}</p>
        </>
      ) : null}
    </Group>
  );
}
