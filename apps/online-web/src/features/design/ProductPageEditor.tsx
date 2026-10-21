import {
  PRODUCT_LAYOUTS,
  PRODUCT_PAGE_PRESETS,
  type ProductHighlight,
  type ProductInfoBlock,
  type ProductLayout,
  type ProductPageDesign,
  type ProductPagePreset,
  type StoreDesign,
  productPagePreset,
  suggestedHighlights,
} from '@arabat/contracts';
import { Button, Field, Input, Select, cn } from '@arabat/ui';
import { localizedName } from '@arabat/web-core';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Choice, LocalizedField, Panel, Toggle, useStoreCatalog } from './fields.js';
import { newId } from './SectionEditor.js';

/*
 * The product page of the store design (ADR-0128 amendment 4): ready pages, recommendations,
 * the arrangement, pictures, product details, the buy box, highlights, description tabs,
 * related and recently viewed products. The sections under the product are edited below it,
 * like any page's sections.
 */

type Set = (next: StoreDesign) => void;
type Page = ProductPageDesign;

const PRESET_ICON: Record<ProductPagePreset, string> = {
  classic: '🛍️',
  fashion: '👗',
  food: '🍔',
  tech: '💻',
  minimal: '➖',
};

// ------------------------------------------------------------- layout thumbnails
/** A small drawing of each arrangement (mirrored in Arabic, like the store). */
export function ProductThumb({ layout }: { layout: ProductLayout }) {
  const soft = 'fill-current opacity-15';
  const ink = 'fill-current opacity-50';
  const brand = 'fill-primary';
  const picture = (x: number, y: number, w: number, h: number) => (
    <rect key={`p-${x}-${y}`} x={x} y={y} width={w} height={h} rx="3" className={soft} />
  );
  const info = (x: number, y: number, w: number) => [
    <rect key={`t-${x}-${y}`} x={x} y={y} width={w * 0.8} height="3" rx="1.5" className={ink} />,
    <rect
      key={`m-${x}-${y}`}
      x={x}
      y={y + 6}
      width={w * 0.4}
      height="3"
      rx="1.5"
      className={brand}
    />,
    <rect key={`d-${x}-${y}`} x={x} y={y + 12} width={w} height="2" rx="1" className={soft} />,
    <rect
      key={`e-${x}-${y}`}
      x={x}
      y={y + 16}
      width={w * 0.7}
      height="2"
      rx="1"
      className={soft}
    />,
    <rect key={`b-${x}-${y}`} x={x} y={y + 22} width={w} height="6" rx="3" className={brand} />,
  ];
  const stacked = [
    picture(36, 2, 48, 18),
    <rect key="t" x="42" y="23" width="36" height="3" rx="1.5" className={ink} />,
    <rect key="m" x="50" y="28" width="20" height="3" rx="1.5" className={brand} />,
    <rect key="b" x="40" y="33" width="40" height="5" rx="2.5" className={brand} />,
  ];
  const body = {
    classic: [picture(6, 4, 52, 32), ...info(66, 6, 48)],
    wide: [picture(6, 4, 66, 32), ...info(78, 6, 36)],
    reverse: [...info(6, 6, 48), picture(62, 4, 52, 32)],
    stacked,
    scroll: [picture(6, 2, 60, 17), picture(6, 21, 60, 17), ...info(74, 6, 40)],
    compact: [picture(18, 9, 28, 22), ...info(54, 6, 48)],
  }[layout];
  return (
    <svg
      viewBox="0 0 120 40"
      className="h-14 w-full overflow-hidden rounded-md bg-surface-muted text-fg rtl:-scale-x-100"
      aria-hidden
    >
      {body}
    </svg>
  );
}

function LayoutGallery({
  value,
  onChange,
}: {
  value: ProductLayout;
  onChange: (v: ProductLayout) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="radiogroup"
      aria-label={t('productDesign.layout')}
      className="grid grid-cols-2 gap-2"
    >
      {PRODUCT_LAYOUTS.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={value === l}
          aria-label={t(`productDesign.layout_${l}`)}
          onClick={() => onChange(l)}
          className={cn(
            'flex flex-col gap-2 rounded-xl border p-2 text-start transition-colors',
            value === l
              ? 'border-primary bg-primary-soft ring-2 ring-primary/30'
              : 'border-border hover:border-border-strong',
          )}
        >
          <ProductThumb layout={l} />
          <span className="px-1">
            <span className="block text-sm font-semibold">{t(`productDesign.layout_${l}`)}</span>
            <span className="block text-xs text-fg-muted">
              {t(`productDesign.layoutHint_${l}`)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------- presets
function Presets({ apply }: { apply: (p: ProductPagePreset) => void }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col gap-2">
      {PRODUCT_PAGE_PRESETS.map((p) => (
        <li
          key={p}
          className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5"
        >
          <span className="relative w-24 shrink-0">
            <ProductThumb layout={productPagePreset(p).layout} />
            <span aria-hidden className="absolute -top-1.5 -start-1.5 text-lg">
              {PRESET_ICON[p]}
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold">{t(`productDesign.preset_${p}`)}</span>
            <span className="block text-xs text-fg-muted">
              {t(`productDesign.presetHint_${p}`)}
            </span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            aria-label={t('design.applyPreset', { name: t(`productDesign.preset_${p}`) })}
            onClick={() => apply(p)}
          >
            {t('design.applyTemplate')}
          </Button>
        </li>
      ))}
    </ul>
  );
}

// ----------------------------------------------------------- recommendations
type Tip = { key: string; done: boolean; fix?: () => void; count?: number };

function Recommendations({
  design,
  update,
}: {
  design: StoreDesign;
  update: (p: Partial<Page>) => void;
}) {
  const { t } = useTranslation();
  const { products } = useStoreCatalog();
  const p = design.productPage;
  const noPicture = products.filter((x) => x.images.length === 0 && !x.imageUrl).length;
  const noWords = products.filter((x) => !x.descriptionEn && !x.descriptionAr).length;
  const kind = design.template === 'restaurant' ? 'food' : 'shop';
  const tips: Tip[] = [
    { key: 'pictures', done: products.length > 0 && noPicture === 0, count: noPicture },
    { key: 'descriptions', done: products.length > 0 && noWords === 0, count: noWords },
    {
      key: 'zoom',
      done: p.gallery.zoom,
      fix: () => update({ gallery: { ...p.gallery, zoom: true } }),
    },
    {
      key: 'highlights',
      done: p.highlights.length > 0,
      fix: () => update({ highlights: suggestedHighlights(kind) }),
    },
    {
      key: 'related',
      done: p.related.enabled,
      fix: () => update({ related: { ...p.related, enabled: true } }),
    },
    {
      key: 'sticky',
      done: p.buy.stickyBar,
      fix: () => update({ buy: { ...p.buy, stickyBar: true } }),
    },
    {
      key: 'whatsapp',
      done: p.buy.whatsapp && Boolean(design.social.whatsapp),
      fix: design.social.whatsapp ? () => update({ buy: { ...p.buy, whatsapp: true } }) : undefined,
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
        <span className="text-xs font-semibold text-fg-muted" data-testid="product-page-score">
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
              <span className="block font-semibold">{t(`productDesign.tip_${tip.key}`)}</span>
              <span className="block text-xs text-fg-muted">
                {t(`productDesign.tipHint_${tip.key}`, { count: tip.count ?? 0 })}
              </span>
            </span>
            {!tip.done && tip.fix ? (
              <Button size="sm" variant="secondary" onClick={tip.fix}>
                {t(`productDesign.tipFix_${tip.key}`)}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- list items
/** Rows of small editable items (highlights, info blocks) with add and remove. */
export function ItemList<T extends { id: string }>({
  items,
  max,
  addLabel,
  onChange,
  blank,
  render,
  label,
}: {
  items: T[];
  max: number;
  addLabel: string;
  onChange: (next: T[]) => void;
  blank: () => T;
  render: (item: T, set: (p: Partial<T>) => void) => ReactNode;
  label: (item: T, index: number) => string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <div key={item.id} className="flex flex-col gap-3 rounded-lg bg-surface-muted p-3">
          {render(item, (p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x))))}
          <Button
            size="sm"
            variant="ghost"
            className="w-fit"
            aria-label={t('productDesign.removeItem', { name: label(item, i) })}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            {t('design.remove')}
          </Button>
        </div>
      ))}
      {items.length < max ? (
        <Button
          size="sm"
          variant="secondary"
          className="w-fit"
          onClick={() => onChange([...items, blank()])}
        >
          {addLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** Up to four reassurance items (emoji, title, words), with suggested ones to start from. */
export function HighlightsField({
  items,
  suggested,
  onChange,
}: {
  items: ProductHighlight[];
  suggested: () => ProductHighlight[];
  onChange: (next: ProductHighlight[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {items.length === 0 ? (
        <Button
          size="sm"
          variant="secondary"
          className="w-fit"
          onClick={() => onChange(suggested())}
        >
          {t('productDesign.useSuggested')}
        </Button>
      ) : null}
      <ItemList<ProductHighlight>
        items={items}
        max={4}
        addLabel={t('productDesign.addHighlight')}
        onChange={onChange}
        label={(h, i) => h.title.ar || h.title.en || String(i + 1)}
        blank={() => ({
          id: newId('highlight'),
          icon: '⭐',
          title: { en: null, ar: null },
          text: { en: null, ar: null },
        })}
        render={(h, setItem) => (
          <>
            <Field label={t('productDesign.icon')} hint={t('productDesign.iconHint')}>
              {(props) => (
                <Input
                  {...props}
                  className="max-w-24"
                  maxLength={8}
                  value={h.icon}
                  onChange={(e) => setItem({ icon: e.target.value })}
                />
              )}
            </Field>
            <LocalizedField
              label={t('design.title')}
              value={h.title}
              max={40}
              onChange={(title) => setItem({ title })}
            />
            <LocalizedField
              label={t('design.text')}
              value={h.text}
              max={80}
              onChange={(text) => setItem({ text })}
            />
          </>
        )}
      />
    </>
  );
}

// -------------------------------------------------------------------- editor
export function ProductPageEditor({
  design,
  set,
  previewProductId,
  onPreviewProduct,
}: {
  design: StoreDesign;
  set: Set;
  previewProductId: string | null;
  onPreviewProduct: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { products } = useStoreCatalog();
  const [presetNote, setPresetNote] = useState<ProductPagePreset | null>(null);
  const p = design.productPage;
  const update = (patch: Partial<Page>) => set({ ...design, productPage: { ...p, ...patch } });
  const info = (patch: Partial<Page['info']>) => update({ info: { ...p.info, ...patch } });
  const gallery = (patch: Partial<Page['gallery']>) =>
    update({ gallery: { ...p.gallery, ...patch } });
  const buy = (patch: Partial<Page['buy']>) => update({ buy: { ...p.buy, ...patch } });
  const related = (patch: Partial<Page['related']>) =>
    update({ related: { ...p.related, ...patch } });
  const kind = design.template === 'restaurant' ? 'food' : 'shop';

  return (
    <div className="flex flex-col gap-4">
      {products.length > 0 ? (
        <Field label={t('productDesign.previewWith')} hint={t('productDesign.previewWithHint')}>
          {(props) => (
            <Select
              {...props}
              value={previewProductId ?? products[0]!.productId}
              onChange={(e) => onPreviewProduct(e.target.value)}
            >
              {products.map((x) => (
                <option key={x.productId} value={x.productId}>
                  {localizedName(x, i18n.language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-3 text-sm text-fg-muted">
          {t('productDesign.noProducts')}
        </p>
      )}

      <Panel
        icon="🪄"
        title={t('productDesign.presets')}
        hint={t('productDesign.presetsHint')}
        defaultOpen={false}
      >
        <Presets
          apply={(preset) => {
            update(productPagePreset(preset));
            setPresetNote(preset);
          }}
        />
        {presetNote ? (
          <p className="text-xs text-success" role="status">
            {t('productDesign.presetApplied', { name: t(`productDesign.preset_${presetNote}`) })}
          </p>
        ) : null}
      </Panel>

      <Panel icon="💡" title={t('productDesign.tips')} hint={t('productDesign.tipsHint')}>
        <Recommendations design={design} update={update} />
      </Panel>

      <Panel icon="🧩" title={t('productDesign.layout')} hint={t('productDesign.layoutHint')}>
        <LayoutGallery value={p.layout} onChange={(layout) => update({ layout })} />
      </Panel>

      <Panel
        icon="🖼️"
        title={t('productDesign.pictures')}
        hint={t('productDesign.picturesHint')}
        defaultOpen={false}
      >
        <Choice
          label={t('productDesign.thumbs')}
          value={p.gallery.thumbs}
          options={(['below', 'side', 'dots', 'none'] as const).map((v) => ({
            value: v,
            label: t(`productDesign.thumbs_${v}`),
          }))}
          onChange={(thumbs) => gallery({ thumbs })}
        />
        <Choice
          label={t('productDesign.ratio')}
          value={p.gallery.ratio}
          options={(['square', 'portrait', 'landscape'] as const).map((v) => ({
            value: v,
            label: t(`productDesign.ratio_${v}`),
          }))}
          onChange={(ratio) => gallery({ ratio })}
        />
        <Choice
          label={t('productDesign.fit')}
          value={p.gallery.fit}
          options={(['cover', 'contain'] as const).map((v) => ({
            value: v,
            label: t(`productDesign.fit_${v}`),
            hint: t(`productDesign.fitHint_${v}`),
          }))}
          onChange={(fit) => gallery({ fit })}
        />
        <Toggle
          label={t('productDesign.zoom')}
          checked={p.gallery.zoom}
          onChange={(zoom) => gallery({ zoom })}
        />
      </Panel>

      <Panel
        icon="🏷️"
        title={t('productDesign.info')}
        hint={t('productDesign.infoHint')}
        defaultOpen={false}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle
            label={t('productDesign.breadcrumb')}
            checked={p.info.breadcrumb}
            onChange={(breadcrumb) => info({ breadcrumb })}
          />
          <Toggle
            label={t('productDesign.category')}
            checked={p.info.category}
            onChange={(category) => info({ category })}
          />
          <Toggle
            label={t('productDesign.share')}
            checked={p.info.share}
            onChange={(share) => info({ share })}
          />
          <Toggle
            label={t('productDesign.sku')}
            checked={p.info.sku}
            onChange={(sku) => info({ sku })}
          />
          <Toggle
            label={t('productDesign.stock')}
            checked={p.info.stock}
            onChange={(stock) => info({ stock })}
          />
        </div>
        <Field label={t('productDesign.lowStockAt')} hint={t('productDesign.lowStockAtHint')}>
          {(props) => (
            <Select
              {...props}
              value={String(p.info.lowStockAt)}
              onChange={(e) => info({ lowStockAt: Number(e.target.value) })}
            >
              <option value="0">{t('productDesign.lowStockOff')}</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {t('productDesign.lowStockAtN', { count: n })}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Choice
          label={t('productDesign.titleSize')}
          value={p.info.titleSize}
          options={(['regular', 'large'] as const).map((v) => ({
            value: v,
            label: t(`productDesign.size_${v}`),
          }))}
          onChange={(titleSize) => info({ titleSize })}
        />
        <Choice
          label={t('productDesign.priceSize')}
          value={p.info.priceSize}
          options={(['regular', 'large'] as const).map((v) => ({
            value: v,
            label: t(`productDesign.size_${v}`),
          }))}
          onChange={(priceSize) => info({ priceSize })}
        />
        <Choice
          label={t('productDesign.align')}
          value={p.info.align}
          options={(['start', 'center'] as const).map((v) => ({
            value: v,
            label: t(`productDesign.align_${v}`),
          }))}
          onChange={(align) => info({ align })}
        />
      </Panel>

      <Panel
        icon="🛒"
        title={t('productDesign.buy')}
        hint={t('productDesign.buyHint')}
        defaultOpen={false}
      >
        <Choice
          label={t('productDesign.options')}
          value={p.buy.options}
          options={(['buttons', 'dropdown'] as const).map((v) => ({
            value: v,
            label: t(`productDesign.options_${v}`),
          }))}
          onChange={(options) => buy({ options })}
        />
        <Choice
          label={t('productDesign.quantity')}
          value={p.buy.quantity}
          options={(['stepper', 'dropdown', 'hidden'] as const).map((v) => ({
            value: v,
            label: t(`productDesign.quantity_${v}`),
          }))}
          onChange={(quantity) => buy({ quantity })}
        />
        <LocalizedField
          label={t('productDesign.addLabel')}
          value={p.buy.addLabel}
          max={30}
          onChange={(addLabel) => buy({ addLabel })}
        />
        <p className="-mt-2 text-xs text-fg-muted">{t('productDesign.addLabelHint')}</p>
        <Toggle
          label={t('productDesign.buyNow')}
          checked={p.buy.buyNow}
          onChange={(buyNow) => buy({ buyNow })}
        />
        <Toggle
          label={t('productDesign.stickyBar')}
          checked={p.buy.stickyBar}
          onChange={(stickyBar) => buy({ stickyBar })}
        />
        <Toggle
          label={t('productDesign.whatsapp')}
          checked={p.buy.whatsapp}
          onChange={(whatsapp) => buy({ whatsapp })}
        />
        {p.buy.whatsapp && !design.social.whatsapp ? (
          <p className="text-xs text-warning">{t('productDesign.whatsappMissing')}</p>
        ) : null}
      </Panel>

      <Panel
        icon="✅"
        title={t('productDesign.highlights')}
        hint={t('productDesign.highlightsHint')}
        defaultOpen={false}
      >
        <HighlightsField
          items={p.highlights}
          suggested={() => suggestedHighlights(kind)}
          onChange={(highlights) => update({ highlights })}
        />
      </Panel>

      <Panel
        icon="📄"
        title={t('productDesign.description')}
        hint={t('productDesign.descriptionHint')}
        defaultOpen={false}
      >
        <Choice
          label={t('productDesign.descriptionStyle')}
          value={p.description.style}
          options={(['plain', 'tabs', 'accordion'] as const).map((v) => ({
            value: v,
            label: t(`productDesign.descriptionStyle_${v}`),
          }))}
          onChange={(style) => update({ description: { ...p.description, style } })}
        />
        <p className="text-sm font-medium">{t('productDesign.blocks')}</p>
        <p className="-mt-3 text-xs text-fg-muted">{t('productDesign.blocksHint')}</p>
        <ItemList<ProductInfoBlock>
          items={p.description.blocks}
          max={4}
          addLabel={t('productDesign.addBlock')}
          onChange={(blocks) => update({ description: { ...p.description, blocks } })}
          label={(b, i) => b.title.ar || b.title.en || String(i + 1)}
          blank={() => ({
            id: newId('info'),
            title: { en: null, ar: null },
            text: { en: null, ar: null },
          })}
          render={(b, setItem) => (
            <>
              <LocalizedField
                label={t('design.title')}
                value={b.title}
                max={40}
                onChange={(title) => setItem({ title })}
              />
              <LocalizedField
                label={t('design.text')}
                value={b.text}
                max={1000}
                multiline
                onChange={(text) => setItem({ text })}
              />
            </>
          )}
        />
      </Panel>

      <Panel
        icon="🔁"
        title={t('productDesign.related')}
        hint={t('productDesign.relatedHint')}
        defaultOpen={false}
      >
        <Toggle
          label={t('productDesign.relatedOn')}
          checked={p.related.enabled}
          onChange={(enabled) => related({ enabled })}
        />
        {p.related.enabled ? (
          <>
            <LocalizedField
              label={t('design.title')}
              value={p.related.title}
              max={80}
              onChange={(title) => related({ title })}
            />
            <Choice
              label={t('productDesign.relatedSource')}
              value={p.related.source}
              options={(['category', 'featured', 'all'] as const).map((v) => ({
                value: v,
                label: t(`productDesign.relatedSource_${v}`),
              }))}
              onChange={(source) => related({ source })}
            />
            <Choice
              label={t('productDesign.relatedVariant')}
              value={p.related.variant}
              options={(['carousel', 'grid'] as const).map((v) => ({
                value: v,
                label: t(`design.variant_${v}`),
              }))}
              onChange={(variant) => related({ variant })}
            />
            <Field label={t('productDesign.relatedLimit')}>
              {(props) => (
                <Select
                  {...props}
                  value={String(p.related.limit)}
                  onChange={(e) => related({ limit: Number(e.target.value) })}
                >
                  {[2, 3, 4, 6, 8, 12].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Toggle
              label={t('productDesign.relatedAdd')}
              checked={p.related.showAdd}
              onChange={(showAdd) => related({ showAdd })}
            />
          </>
        ) : null}
      </Panel>

      <Panel
        icon="👀"
        title={t('productDesign.recent')}
        hint={t('productDesign.recentHint')}
        defaultOpen={false}
      >
        <Toggle
          label={t('productDesign.recentOn')}
          checked={p.recent.enabled}
          onChange={(enabled) => update({ recent: { ...p.recent, enabled } })}
        />
        {p.recent.enabled ? (
          <LocalizedField
            label={t('design.title')}
            value={p.recent.title}
            max={80}
            onChange={(title) => update({ recent: { ...p.recent, title } })}
          />
        ) : null}
      </Panel>
    </div>
  );
}
