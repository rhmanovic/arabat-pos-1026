import {
  CATEGORY_LAYOUTS,
  type CategoryLayout,
  type DesignPage,
  type DesignSection,
  HOME_LAYOUTS,
  type HomeLayout,
  READY_SECTIONS,
  type ReadySection,
  type SectionType,
  type StoreDesign,
  categoryLayout,
  homeLayout,
  newSection,
  readySection,
} from '@arabat/contracts';
import { Badge, Button, Dialog, Input, cn } from '@arabat/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SECTION_ICON, newId, sectionOrder } from './SectionEditor.js';
import { useStoreCatalog } from './fields.js';

/*
 * Page tools of the design console (ADR-0128 amendment 3): the section gallery with drawings and
 * search, ready-made sections, whole home-page layouts and the home-page recommendations.
 */

// --------------------------------------------------------------------- thumbnails
/** A small drawing of each section type, so the merchant picks by looks. */
export function SectionThumb({ type }: { type: SectionType }) {
  const ink = 'fill-current opacity-45';
  const soft = 'fill-current opacity-15';
  const brand = 'fill-primary';
  const r = (x: number, y: number, w: number, h: number, c = soft, rx = 2) => (
    <rect key={`${x}-${y}-${w}`} x={x} y={y} width={w} height={h} rx={rx} className={c} />
  );
  const line = (x: number, y: number, w: number) => r(x, y, w, 2.5, ink, 1.25);
  const body: Record<SectionType, ReactNode[]> = {
    slider: [r(6, 4, 108, 24, brand, 3), line(12, 18, 30), r(52, 25, 16, 1.5, 'fill-white')],
    banner: [
      r(6, 4, 108, 24, soft, 3),
      line(14, 12, 40),
      line(14, 17, 28),
      r(14, 21, 18, 4, brand),
    ],
    products: [r(6, 6, 24, 20), r(34, 6, 24, 20), r(62, 6, 24, 20), r(90, 6, 24, 20)],
    categories: [8, 30, 52, 74, 96].map((x) => (
      <circle key={x} cx={x + 8} cy={14} r={7} className={soft} />
    )),
    image: [r(6, 4, 108, 24, soft, 3), <circle key="sun" cx="96" cy="11" r="4" className={ink} />],
    video: [
      r(6, 4, 108, 24, 'fill-current opacity-70', 3),
      <path key="play" d="M55 10 L67 16 L55 22 Z" className="fill-white" />,
    ],
    text: [line(20, 9, 80), line(28, 15, 64), line(36, 21, 48)],
    features: [r(6, 8, 32, 16), r(44, 8, 32, 16), r(82, 8, 32, 16)],
    menu: [line(8, 6, 30), r(8, 11, 50, 7), r(62, 11, 50, 7), r(8, 21, 50, 7), r(62, 21, 50, 7)],
    info: [r(6, 11, 32, 10, soft, 5), r(44, 11, 32, 10, soft, 5), r(82, 11, 32, 10, soft, 5)],
    catalog: [
      r(6, 4, 40, 5),
      r(6, 12, 24, 16),
      r(34, 12, 24, 16),
      r(62, 12, 24, 16),
      r(90, 12, 24, 16),
    ],
    countdown: [
      r(6, 5, 108, 22, brand, 3),
      ...[52, 66, 80, 94].map((x) => r(x, 10, 11, 12, 'fill-white opacity-80')),
    ],
    testimonials: [
      r(6, 6, 34, 20),
      r(43, 6, 34, 20),
      r(80, 6, 34, 20),
      line(10, 11, 22),
      line(47, 11, 22),
      line(84, 11, 22),
    ],
    faq: [r(6, 5, 108, 6), r(6, 13, 108, 6), r(6, 21, 108, 6)],
    gallery: [r(6, 4, 50, 24), r(60, 4, 26, 11), r(88, 4, 26, 11), r(60, 17, 54, 11)],
    logos: [12, 34, 56, 78, 100].map((x) => r(x - 6, 12, 16, 8, ink, 2)),
    collage: [r(6, 4, 54, 24, brand, 3), r(63, 4, 51, 11, soft, 3), r(63, 17, 51, 11, soft, 3)],
    cta: [r(6, 5, 108, 22, brand, 3), line(40, 11, 40), r(46, 17, 28, 5, 'fill-white')],
    spacer: [r(6, 15, 108, 1.5, ink, 0.75)],
  };
  return (
    <svg
      viewBox="0 0 120 32"
      className="h-12 w-full overflow-hidden rounded-md bg-surface-muted text-fg"
      aria-hidden
    >
      {body[type]}
    </svg>
  );
}

const GROUPS: { key: string; types: SectionType[] }[] = [
  { key: 'hero', types: ['slider', 'banner', 'collage', 'countdown', 'cta'] },
  { key: 'shop', types: ['products', 'categories', 'catalog', 'menu'] },
  { key: 'content', types: ['text', 'image', 'video', 'gallery'] },
  { key: 'trust', types: ['features', 'testimonials', 'faq', 'logos', 'info'] },
  { key: 'layout', types: ['spacer'] },
];
const READY_TYPE: Record<ReadySection, SectionType> = {
  heroSlider: 'slider',
  offerCountdown: 'countdown',
  collage: 'collage',
  newArrivals: 'products',
  featured: 'products',
  shopByCategory: 'categories',
  trustStrip: 'features',
  reviews: 'testimonials',
  faq: 'faq',
  contactCta: 'cta',
  brands: 'logos',
  story: 'text',
};

// ------------------------------------------------------------------------ picker
export function SectionPicker({
  design,
  onClose,
  onPick,
  exclude = [],
}: {
  design: StoreDesign;
  onClose: () => void;
  onPick: (section: DesignSection) => void;
  /** Types the page cannot hold (the product page has no catalog or menu). */
  exclude?: SectionType[];
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'types' | 'ready'>('types');
  const [search, setSearch] = useState('');
  const suggested = sectionOrder(design.template).slice(0, 3);
  const term = search.trim().toLowerCase();
  const matches = (type: SectionType) =>
    !exclude.includes(type) &&
    (!term ||
      `${t(`design.type_${type}`)} ${t(`design.typeHint_${type}`)}`.toLowerCase().includes(term));
  const fromReady = (name: ReadySection) => {
    const section = readySection(name, newId(READY_TYPE[name]));
    // The contact call to action goes to the store's WhatsApp when it has one.
    if (section.type === 'cta' && design.social.whatsapp)
      section.link = {
        kind: 'url',
        url: `https://wa.me/${design.social.whatsapp.replace(/^\+/, '')}`,
      };
    return section;
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={t('design.addSection')}
      description={t(`design.pickerHint_${design.template}`)}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <div
          role="tablist"
          aria-label={t('design.addSection')}
          className="grid grid-cols-2 gap-1 rounded-xl bg-surface-muted p-1"
        >
          {(['types', 'ready'] as const).map((x) => (
            <button
              key={x}
              type="button"
              role="tab"
              aria-selected={tab === x}
              onClick={() => setTab(x)}
              className={cn(
                'rounded-lg px-3 py-2 text-sm font-semibold',
                tab === x ? 'bg-surface shadow-sm' : 'text-fg-muted',
              )}
            >
              {t(`design.pickerTab_${x}`)}
            </button>
          ))}
        </div>
        {tab === 'types' ? (
          <>
            <Input
              type="search"
              aria-label={t('design.searchSections')}
              placeholder={t('design.searchSections')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {GROUPS.map((g) => {
              const types = g.types.filter(matches);
              if (types.length === 0) return null;
              return (
                <section key={g.key} aria-label={t(`design.group_${g.key}`)}>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-fg-muted">
                    {t(`design.group_${g.key}`)}
                  </h3>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {types.map((type) => (
                      <li key={type}>
                        <button
                          type="button"
                          onClick={() => onPick(sectionFor(type))}
                          className="vibe-lift flex w-full flex-col gap-2 rounded-xl border border-border bg-surface p-2.5 text-start"
                        >
                          <span className="flex items-center gap-2 text-sm font-semibold">
                            {t(`design.type_${type}`)}
                            {suggested.includes(type) ? (
                              <Badge tone="primary">{t('design.suggested')}</Badge>
                            ) : null}
                          </span>
                          <SectionThumb type={type} />
                          <span className="text-xs text-fg-muted">
                            {t(`design.typeHint_${type}`)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {READY_SECTIONS.filter((name) => !exclude.includes(READY_TYPE[name])).map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => onPick(fromReady(name))}
                  className="vibe-lift flex w-full flex-col gap-2 rounded-xl border border-border bg-surface p-2.5 text-start"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <span aria-hidden>{SECTION_ICON[READY_TYPE[name]]}</span>
                    {t(`design.ready_${name}`)}
                  </span>
                  <SectionThumb type={READY_TYPE[name]} />
                  <span className="text-xs text-fg-muted">{t(`design.readyHint_${name}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

/** A new section of a type with its defaults and its own id. */
export function sectionFor(type: SectionType): DesignSection {
  return newSection(type, newId(type));
}

// -------------------------------------------------------------------- page layouts
const LAYOUT_ICON: Record<HomeLayout | `categories:${CategoryLayout}`, string> = {
  fashion: '👗',
  electronics: '🎧',
  grocery: '🥑',
  beauty: '💄',
  restaurant: '🍔',
  cafe: '☕',
  minimal: '◻️',
  'categories:tiles': '🧱',
  'categories:circles': '⭕',
  'categories:cards': '🃏',
  'categories:list': '📋',
  'categories:showcase': '✨',
};

/** Whole pages in one tap: the home page's and the categories page's (ADR-0128 amendment 6). */
export function PageLayouts({
  page = 'home',
  onApply,
}: {
  page?: 'home' | 'categories';
  onApply: (sections: DesignSection[]) => void;
}) {
  return page === 'categories' ? (
    <LayoutChoices
      names={CATEGORY_LAYOUTS}
      label={(l) => `design.categoryLayout_${l}`}
      icon={(l) => LAYOUT_ICON[`categories:${l}`]}
      build={categoryLayout}
      prefix="category"
      onApply={onApply}
    />
  ) : (
    <LayoutChoices
      names={HOME_LAYOUTS}
      label={(l) => `design.homeLayout_${l}`}
      icon={(l) => LAYOUT_ICON[l]}
      build={homeLayout}
      prefix=""
      onApply={onApply}
    />
  );
}

function LayoutChoices<L extends string>({
  names,
  label,
  icon,
  build,
  prefix,
  onApply,
}: {
  /** "" for the home page's words, "category" for the categories page's. */
  prefix: '' | 'category';
  names: readonly L[];
  label: (l: L) => string;
  icon: (l: L) => string;
  build: (l: L) => DesignSection[];
  onApply: (sections: DesignSection[]) => void;
}) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState<L | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-2 gap-2">
        {names.map((l) => (
          <li key={l}>
            <button
              type="button"
              aria-label={t('design.useLayout', { name: t(label(l)) })}
              onClick={() => setConfirm(l)}
              className={cn(
                'flex w-full flex-col items-start gap-1 rounded-xl border p-3 text-start transition-colors',
                confirm === l
                  ? 'border-primary bg-primary-soft'
                  : 'border-border hover:border-border-strong',
              )}
            >
              <span aria-hidden className="text-2xl">
                {icon(l)}
              </span>
              <span className="text-sm font-bold">{t(label(l))}</span>
              <span className="text-xs text-fg-muted">
                {t('design.sectionsCount', { count: build(l).length })}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {confirm ? (
        <div className="flex flex-col gap-2 rounded-xl border border-warning bg-warning-soft p-3 text-sm">
          <p>{t(prefix ? 'design.categoryLayoutWarning' : 'design.layoutWarning')}</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                onApply(build(confirm));
                setConfirm(null);
              }}
            >
              {t(prefix ? 'design.categoryLayoutConfirm' : 'design.layoutConfirm')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ recommendations
/** A section that shows nothing to shoppers yet (missing pictures, answers, an end date…). */
export function isEmptySection(s: DesignSection): boolean {
  const has = (v: { en: string | null; ar: string | null }) => Boolean(v.en || v.ar);
  switch (s.type) {
    case 'slider':
      return s.slides.length === 0;
    case 'testimonials':
      return !s.items.some((i) => has(i.quote));
    case 'faq':
      return !s.items.some((i) => has(i.question) && has(i.answer));
    case 'gallery':
    case 'logos':
      return !s.items.some((i) => i.imageId);
    case 'collage':
      return !s.tiles.some((x) => has(x.title) || x.imageId);
    case 'countdown':
      return !s.endsAt || Date.parse(s.endsAt) <= Date.now();
    case 'text':
      return !has(s.title) && !has(s.body);
    case 'features':
      return s.items.length === 0;
    case 'image':
      return !s.imageId;
    case 'video':
      return !s.url;
    default:
      return false;
  }
}

export function PageTips({
  design,
  page,
  sections,
  onChange,
  onEdit,
}: {
  design: StoreDesign;
  page: DesignPage;
  sections: DesignSection[];
  onChange: (next: DesignSection[]) => void;
  onEdit: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (page === 'categories')
    return <CategoryTips sections={sections} onChange={onChange} onEdit={onEdit} />;
  if (page !== 'home') return null;
  const shown = sections.filter((s) => s.visible);
  const has = (...types: SectionType[]) => shown.some((s) => types.includes(s.type));
  const add =
    (name: ReadySection, atStart = false) =>
    () => {
      const s = readySection(name, newId(READY_TYPE[name]));
      if (s.type === 'cta' && design.social.whatsapp)
        s.link = { kind: 'url', url: `https://wa.me/${design.social.whatsapp.replace(/^\+/, '')}` };
      onChange(atStart ? [s, ...sections] : [...sections, s]);
    };
  const empty = shown.filter(isEmptySection);
  const restaurant = design.template === 'restaurant';
  const tips: { key: string; done: boolean; fix?: () => void; fixLabel?: string }[] = [
    {
      key: 'hero',
      done: ['slider', 'banner', 'collage', 'countdown'].includes(shown[0]?.type ?? ''),
      fix: add('heroSlider', true),
    },
    {
      key: 'products',
      done: has('products', 'catalog', 'menu'),
      fix: add(restaurant ? 'featured' : 'newArrivals'),
    },
    {
      key: 'categories',
      done: restaurant || has('categories', 'menu'),
      fix: add('shopByCategory'),
    },
    { key: 'trust', done: has('features', 'testimonials', 'logos', 'faq'), fix: add('trustStrip') },
    { key: 'action', done: has('cta', 'countdown'), fix: add('contactCta') },
    {
      key: 'empty',
      done: empty.length === 0,
      fix: empty[0] ? () => onEdit(empty[0]!.id) : undefined,
      fixLabel: t('design.tipFix_emptyOpen'),
    },
    { key: 'length', done: shown.length <= 12 },
  ];
  const done = tips.filter((x) => x.done).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.round((done / tips.length) * 100)}%` }}
          />
        </div>
        <span className="text-xs font-semibold text-fg-muted" data-testid="page-score">
          {t('design.tipsDone', { done, total: tips.length })}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {tips.map((tip) => (
          <li
            key={tip.key}
            className={cn(
              'flex items-start gap-3 rounded-lg p-3 text-sm',
              tip.done ? 'bg-surface-muted' : 'border border-dashed border-border-strong',
            )}
          >
            <span aria-hidden>{tip.done ? '✅' : '💡'}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{t(`design.pageTip_${tip.key}`)}</span>
              <span className="block text-xs text-fg-muted">
                {tip.key === 'empty' && empty.length > 0
                  ? t('design.pageTipHint_emptyList', {
                      names: empty.map((s) => t(`design.type_${s.type}`)).join('، '),
                    })
                  : tip.key === 'length'
                    ? t('design.pageTipHint_length', { count: shown.length })
                    : t(`design.pageTipHint_${tip.key}`)}
              </span>
            </span>
            {!tip.done && tip.fix ? (
              <Button size="sm" variant="secondary" onClick={tip.fix}>
                {tip.fixLabel ?? t('design.pageTipFix')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What a categories page that leads shoppers on usually has (ADR-0128 amendment 6). */
function CategoryTips({
  sections,
  onChange,
  onEdit,
}: {
  sections: DesignSection[];
  onChange: (next: DesignSection[]) => void;
  onEdit: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { store } = useStoreCatalog();
  const categories = store?.categories ?? [];
  const main = sections.find((s) => s.visible && s.type === 'categories');
  const shown = sections.filter((s) => s.visible);
  const setMain = (patch: Record<string, unknown>) =>
    main
      ? () =>
          onChange(
            sections.map((s) => (s.id === main.id ? ({ ...s, ...patch } as DesignSection) : s)),
          )
      : undefined;
  const noPicture = categories.filter((c) => !c.imageUrl).length;
  const nested = categories.some((c) => c.parentId);
  const empty = shown.filter(isEmptySection);
  const tips: { key: string; done: boolean; fix?: () => void; count?: number; label?: string }[] = [
    { key: 'catPictures', done: categories.length > 0 && noPicture === 0, count: noPicture },
    {
      key: 'catCounts',
      done: main?.type === 'categories' && main.showCount,
      fix: setMain({ showCount: true }),
    },
    {
      key: 'catNested',
      done: !nested || (main?.type === 'categories' && (main.topOnly || main.showSub)),
      fix: setMain({ topOnly: true, showSub: true }),
    },
    {
      key: 'catProducts',
      done: shown.some((s) => s.type === 'products'),
      fix: () => onChange([...sections, readySection('featured', newId('products'))]),
    },
    {
      key: 'empty',
      done: empty.length === 0,
      fix: empty[0] ? () => onEdit(empty[0]!.id) : undefined,
      label: t('design.tipFix_emptyOpen'),
    },
  ];
  const done = tips.filter((x) => x.done).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.round((done / tips.length) * 100)}%` }}
          />
        </div>
        <span className="text-xs font-semibold text-fg-muted" data-testid="page-score">
          {t('design.tipsDone', { done, total: tips.length })}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {tips.map((tip) => (
          <li
            key={tip.key}
            className={cn(
              'flex items-start gap-3 rounded-lg p-3 text-sm',
              tip.done ? 'bg-surface-muted' : 'border border-dashed border-border-strong',
            )}
          >
            <span aria-hidden>{tip.done ? '✅' : '💡'}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{t(`design.pageTip_${tip.key}`)}</span>
              <span className="block text-xs text-fg-muted">
                {t(`design.pageTipHint_${tip.key}`, { count: tip.count ?? 0 })}
              </span>
            </span>
            {!tip.done && tip.fix ? (
              <Button size="sm" variant="secondary" onClick={tip.fix}>
                {tip.label ?? t('design.pageTipFix')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
