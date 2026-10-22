import {
  SALE_BADGE_COLOURS,
  SALE_BADGE_POSITIONS,
  SALE_BADGE_SHAPES,
  SALE_BADGE_SIZES,
  SALE_BADGE_STYLES,
  SALE_BADGE_TEXTS,
  type SaleBadgeDesign,
  type StoreDesign,
} from '@arabat/contracts';
import { cn } from '@arabat/ui';
import { readableOn } from '@arabat/web-core';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Choice, LocalizedField, Panel, Toggle } from './fields.js';
import { ColourField } from './SectionEditor.js';

type Set = (next: StoreDesign) => void;
type Where = 'card' | 'page';

/*
 * How discounted products look in the store (ADR-0133): the badge on cards and on the product
 * page (words, colour, size, shape, corner), the old price, the colour of the new price, the
 * saving and the end of the offer. The small preview here mirrors the storefront's badge, so
 * the look can be chosen before any discount runs.
 */

const COLOURS: Record<string, string> = {
  red: '#dc2626',
  dark: '#111827',
  green: '#16a34a',
  orange: '#ea580c',
  pink: '#db2777',
  gold: '#b45309',
};
const hexOf = (b: SaleBadgeDesign) =>
  b.colour === 'brand'
    ? null
    : b.colour === 'custom'
      ? (b.customColour ?? COLOURS.red!)
      : COLOURS[b.colour]!;
const SIZE = {
  sm: 'px-1.5 py-0.5 text-[0.6rem]',
  md: 'px-2 py-0.5 text-[0.7rem]',
  lg: 'px-2.5 py-1 text-xs',
  xl: 'px-3 py-1 text-sm',
};
const CIRCLE = {
  sm: 'size-9 text-[0.6rem]',
  md: 'size-10 text-[0.7rem]',
  lg: 'size-12 text-xs',
  xl: 'size-14 text-sm',
};
const PLACE = {
  'top-start': 'top-1.5 start-1.5',
  'top-end': 'top-1.5 end-1.5',
  'bottom-start': 'bottom-1.5 start-1.5',
  'bottom-end': 'bottom-1.5 end-1.5',
};
const RIBBON = {
  'top-start': 'top-2 start-0 rounded-e-md',
  'top-end': 'top-2 end-0 rounded-s-md',
  'bottom-start': 'bottom-2 start-0 rounded-e-md',
  'bottom-end': 'bottom-2 end-0 rounded-s-md',
};

function BadgeSample({ badge, words }: { badge: SaleBadgeDesign; words: string }) {
  const hex = hexOf(badge);
  const style: CSSProperties =
    badge.style === 'solid'
      ? hex
        ? { backgroundColor: hex, color: readableOn(hex) }
        : {}
      : badge.style === 'soft'
        ? hex
          ? { backgroundColor: `${hex}26`, color: hex }
          : {}
        : hex
          ? { borderColor: hex, color: hex }
          : {};
  return (
    <span
      className={cn(
        'absolute z-[1] inline-flex items-center justify-center text-center font-bold leading-tight shadow-sm',
        badge.shape === 'ribbon' ? RIBBON[badge.position] : PLACE[badge.position],
        badge.shape === 'circle' ? cn('rounded-full p-1', CIRCLE[badge.size]) : SIZE[badge.size],
        badge.shape === 'pill' && 'rounded-full',
        badge.shape === 'rounded' && 'rounded-md',
        badge.shape === 'tag' &&
          'rounded-s-sm pe-3 [clip-path:polygon(0_0,calc(100%-8px)_0,100%_50%,calc(100%-8px)_100%,0_100%)] rtl:[clip-path:polygon(8px_0,100%_0,100%_100%,8px_100%,0_50%)]',
        badge.style === 'solid' && !hex && 'bg-primary text-primary-fg',
        badge.style === 'soft' && !hex && 'bg-primary-soft text-primary',
        badge.style === 'outline' && 'border-2 bg-surface',
        badge.style === 'outline' && !hex && 'border-primary text-primary',
        badge.pulse && 'animate-pulse',
      )}
      style={style}
      data-testid="sale-badge-sample"
    >
      <bdi dir={badge.text === 'percent' ? 'ltr' : 'auto'}>{words}</bdi>
    </span>
  );
}

/** A card as the store shows a discounted product, with the chosen look. */
function Sample({ design, where }: { design: StoreDesign; where: Where }) {
  const { t, i18n } = useTranslation();
  const sale = design.sale;
  const badge = sale[where];
  const ar = i18n.language.startsWith('ar');
  const words =
    badge.text === 'amount'
      ? t('design.sale_sampleSave')
      : badge.text === 'word'
        ? t('design.sale_sampleWord')
        : badge.text === 'custom'
          ? (ar
              ? badge.customText.ar || badge.customText.en
              : badge.customText.en || badge.customText.ar) || t('design.sale_sampleWord')
          : '-20%';
  const priceStyle: CSSProperties | undefined =
    sale.priceColour === 'badge' && hexOf(sale.card) ? { color: hexOf(sale.card)! } : undefined;
  const priceClass =
    sale.priceColour === 'brand' || (sale.priceColour === 'badge' && !hexOf(sale.card))
      ? 'text-primary'
      : undefined;
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-border bg-surface',
        where === 'card' ? 'w-40' : 'w-full max-w-xs',
      )}
    >
      <div className="relative aspect-square bg-gradient-to-br from-surface-muted to-border">
        {badge.show ? <BadgeSample badge={badge} words={words} /> : null}
        <span aria-hidden className="absolute inset-0 grid place-items-center text-4xl opacity-40">
          🛍️
        </span>
      </div>
      <div className="flex flex-col gap-0.5 p-2.5">
        <p className="text-sm font-medium">{t('design.sale_sampleName')}</p>
        <p className="flex flex-wrap items-baseline gap-2 text-sm tabular-nums" dir="ltr">
          <span className={cn('font-semibold', priceClass)} style={priceStyle}>
            1.000
          </span>
          {sale.oldPrice ? <s className="text-xs text-fg-muted">1.250</s> : null}
        </p>
        {where === 'page' && sale.savings ? (
          <p className="text-xs font-medium text-danger">{t('design.sale_sampleSaving')}</p>
        ) : null}
      </div>
    </div>
  );
}

function BadgeFields({
  badge,
  onChange,
}: {
  badge: SaleBadgeDesign;
  onChange: (next: SaleBadgeDesign) => void;
}) {
  const { t } = useTranslation();
  const set = (p: Partial<SaleBadgeDesign>) => onChange({ ...badge, ...p });
  return (
    <>
      <Toggle
        label={t('design.sale_show')}
        checked={badge.show}
        onChange={(show) => set({ show })}
      />
      {badge.show ? (
        <>
          <Choice
            label={t('design.sale_text')}
            value={badge.text}
            options={SALE_BADGE_TEXTS.map((v) => ({ value: v, label: t(`design.sale_text_${v}`) }))}
            onChange={(text) => set({ text })}
          />
          {badge.text === 'custom' ? (
            <LocalizedField
              label={t('design.sale_customText')}
              max={20}
              value={badge.customText}
              onChange={(customText) => set({ customText })}
            />
          ) : null}
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">{t('design.sale_colour')}</p>
            <div
              role="radiogroup"
              aria-label={t('design.sale_colour')}
              className="flex flex-wrap gap-2"
            >
              {SALE_BADGE_COLOURS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={badge.colour === c}
                  aria-label={t(`design.sale_colour_${c}`)}
                  title={t(`design.sale_colour_${c}`)}
                  onClick={() => set({ colour: c })}
                  className={cn(
                    'grid size-9 place-items-center rounded-full border-2 text-xs font-bold',
                    badge.colour === c ? 'border-fg ring-2 ring-primary/40' : 'border-transparent',
                    c === 'brand' && 'bg-primary text-primary-fg',
                    c === 'custom' &&
                      'bg-[conic-gradient(red,orange,yellow,green,blue,violet,red)]',
                  )}
                  style={COLOURS[c] ? { backgroundColor: COLOURS[c] } : undefined}
                >
                  {c === 'brand' ? 'A' : ''}
                </button>
              ))}
            </div>
          </div>
          {badge.colour === 'custom' ? (
            <ColourField
              label={t('design.sale_customColour')}
              value={badge.customColour}
              onChange={(customColour) => set({ customColour })}
            />
          ) : null}
          <Choice
            label={t('design.sale_style')}
            value={badge.style}
            options={SALE_BADGE_STYLES.map((v) => ({
              value: v,
              label: t(`design.sale_style_${v}`),
            }))}
            onChange={(style) => set({ style })}
          />
          <Choice
            label={t('design.sale_size')}
            value={badge.size}
            options={SALE_BADGE_SIZES.map((v) => ({ value: v, label: t(`design.sale_size_${v}`) }))}
            onChange={(size) => set({ size })}
          />
          <Choice
            label={t('design.sale_shape')}
            value={badge.shape}
            options={SALE_BADGE_SHAPES.map((v) => ({
              value: v,
              label: t(`design.sale_shape_${v}`),
            }))}
            onChange={(shape) => set({ shape })}
          />
          <Choice
            label={t('design.sale_position')}
            value={badge.position}
            options={SALE_BADGE_POSITIONS.map((v) => ({
              value: v,
              label: t(`design.sale_position_${v.replace('-', '_')}`),
            }))}
            onChange={(position) => set({ position })}
          />
          <Toggle
            label={t('design.sale_pulse')}
            checked={badge.pulse}
            onChange={(pulse) => set({ pulse })}
          />
        </>
      ) : null}
    </>
  );
}

export function SaleEditor({ design, set }: { design: StoreDesign; set: Set }) {
  const { t } = useTranslation();
  const sale = design.sale;
  const update = (p: Partial<StoreDesign['sale']>) => set({ ...design, sale: { ...sale, ...p } });
  return (
    <div className="flex flex-col gap-4" data-testid="sale-editor">
      <p className="text-sm text-fg-muted">
        {t('design.sale_hint')}{' '}
        <Link to="/discounts" className="text-primary hover:underline">
          {t('nav.discounts')}
        </Link>
      </p>
      <Panel title={t('design.sale_card')} hint={t('design.sale_cardHint')} icon="🏷️">
        <div className="flex flex-col gap-4 sm:flex-row-reverse sm:items-start">
          <div className="flex justify-center sm:sticky sm:top-4">
            <Sample design={design} where="card" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <BadgeFields badge={sale.card} onChange={(card) => update({ card })} />
          </div>
        </div>
      </Panel>
      <Panel
        title={t('design.sale_page')}
        hint={t('design.sale_pageHint')}
        icon="🔖"
        defaultOpen={false}
      >
        <div className="flex flex-col gap-4 sm:flex-row-reverse sm:items-start">
          <div className="flex justify-center sm:w-56">
            <Sample design={design} where="page" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <BadgeFields badge={sale.page} onChange={(page) => update({ page })} />
          </div>
        </div>
      </Panel>
      <Panel
        title={t('design.sale_prices')}
        hint={t('design.sale_pricesHint')}
        icon="💲"
        defaultOpen={false}
      >
        <Toggle
          label={t('design.sale_oldPrice')}
          checked={sale.oldPrice}
          onChange={(oldPrice) => update({ oldPrice })}
        />
        <Choice
          label={t('design.sale_priceColour')}
          value={sale.priceColour}
          options={(['badge', 'brand', 'default'] as const).map((v) => ({
            value: v,
            label: t(`design.sale_priceColour_${v}`),
          }))}
          onChange={(priceColour) => update({ priceColour })}
        />
        <Toggle
          label={t('design.sale_savings')}
          checked={sale.savings}
          onChange={(savings) => update({ savings })}
        />
        <Toggle
          label={t('design.sale_endsIn')}
          checked={sale.endsIn}
          onChange={(endsIn) => update({ endsIn })}
        />
      </Panel>
    </div>
  );
}
