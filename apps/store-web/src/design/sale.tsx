import type { SaleBadgeDesign, StoreProduct } from '@arabat/contracts';
import type { Money } from '@arabat/money';
import { cn } from '@arabat/ui';
import { readableOn } from '@arabat/web-core';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { toMoney } from '../cart.js';
import { useMoney } from '../shared.js';
import { useDesign, useText } from './context.js';

/*
 * Discounted products (ADR-0133): the server sends the price in force and, while a product
 * discount runs, the regular price and its end. Here only the look is decided, from the
 * merchant's design (`design.sale`): the badge on the picture, the old price struck through,
 * the colour of the new price, the saving and the end of the offer.
 */

type Variant = StoreProduct['variants'][number];
export type SaleInfo = {
  price: Money;
  regular: Money;
  saving: Money;
  /** Whole percentage saved (at least 1). */
  percent: number;
  endsAt: string | null;
};

/** The discount of one option, or null when it sells at its regular price. */
export function variantSale(v: Variant): SaleInfo | null {
  if (!v.regularPrice) return null;
  const price = toMoney(v.price);
  const regular = toMoney(v.regularPrice);
  if (price.compare(regular) >= 0) return null;
  const saving = regular.subtract(price);
  const percent = Math.max(1, Number((saving.minor * 100n) / regular.minor));
  return { price, regular, saving, percent, endsAt: v.discountEndsAt ?? null };
}

/**
 * A product's discount as a card shows it: the option with the lowest price (the one the card
 * shows), and the largest percentage among its options for the badge.
 */
export function productSale(p: StoreProduct): SaleInfo | null {
  const sales = p.variants.map(variantSale);
  if (!sales.some(Boolean)) return null;
  const cheapest = p.variants.reduce((a, b) =>
    toMoney(b.price).compare(toMoney(a.price)) < 0 ? b : a,
  );
  const shown = variantSale(cheapest) ?? sales.find(Boolean)!;
  const percent = Math.max(...sales.map((s) => s?.percent ?? 0));
  return { ...shown, percent };
}

const COLOURS: Record<Exclude<SaleBadgeDesign['colour'], 'brand' | 'custom'>, string> = {
  red: '#dc2626',
  dark: '#111827',
  green: '#16a34a',
  orange: '#ea580c',
  pink: '#db2777',
  gold: '#b45309',
};

/** The badge's colour as `#rrggbb`, or null for the store colour. */
function badgeHex(badge: SaleBadgeDesign): string | null {
  if (badge.colour === 'brand') return null;
  if (badge.colour === 'custom') return badge.customColour ?? COLOURS.red;
  return COLOURS[badge.colour];
}

/** The colour a discounted price takes (`design.sale.priceColour`). */
export function useSalePriceStyle(): { className?: string; style?: CSSProperties } {
  const sale = useDesign().sale;
  if (sale.priceColour === 'default') return {};
  if (sale.priceColour === 'brand') return { className: 'text-primary' };
  const hex = badgeHex(sale.card);
  return hex ? { style: { color: hex } } : { className: 'text-primary' };
}

const SIZE = {
  sm: 'px-1.5 py-0.5 text-[0.65rem]',
  md: 'px-2 py-0.5 text-xs',
  lg: 'px-2.5 py-1 text-sm',
  xl: 'px-3 py-1.5 text-base',
};
const CIRCLE = {
  sm: 'size-10 text-[0.65rem]',
  md: 'size-12 text-xs',
  lg: 'size-14 text-sm',
  xl: 'size-16 text-base',
};
const PLACE = {
  'top-start': 'top-2 start-2',
  'top-end': 'top-2 end-2',
  'bottom-start': 'bottom-2 start-2',
  'bottom-end': 'bottom-2 end-2',
};
/** A ribbon sits flush against the picture's side. */
const RIBBON_PLACE = {
  'top-start': 'top-3 start-0 rounded-e-md',
  'top-end': 'top-3 end-0 rounded-s-md',
  'bottom-start': 'bottom-3 start-0 rounded-e-md',
  'bottom-end': 'bottom-3 end-0 rounded-s-md',
};

/** The badge's words: "-20%", "Save 0.250 KWD", "Sale" or the merchant's own. */
function useBadgeText() {
  const { t } = useTranslation();
  const text = useText();
  const money = useMoney();
  return (badge: SaleBadgeDesign, sale: SaleInfo) =>
    badge.text === 'amount'
      ? t('design.saleSave', { amount: money(sale.saving) })
      : badge.text === 'word'
        ? t('design.saleWord')
        : badge.text === 'custom'
          ? text(badge.customText) || t('design.saleWord')
          : `-${sale.percent}%`;
}

/** The discount badge on a picture (`where` = cards in lists, or the product page). */
export function SaleBadge({
  sale,
  where,
  className,
}: {
  sale: SaleInfo | null;
  where: 'card' | 'page';
  className?: string;
}) {
  const design = useDesign().sale;
  const words = useBadgeText();
  const badge = where === 'card' ? design.card : design.page;
  if (!sale || !badge.show) return null;
  const hex = badgeHex(badge);
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
  const brand = !hex;
  return (
    <span
      data-sale-badge={badge.shape}
      className={cn(
        'pointer-events-none absolute z-[2] inline-flex items-center justify-center text-center font-bold leading-tight tabular-nums shadow-sm',
        badge.shape === 'ribbon' ? RIBBON_PLACE[badge.position] : PLACE[badge.position],
        badge.shape === 'circle' ? cn('rounded-full p-1', CIRCLE[badge.size]) : SIZE[badge.size],
        badge.shape === 'pill' && 'rounded-full',
        badge.shape === 'rounded' && 'rounded-md',
        badge.shape === 'square' && 'rounded-none',
        badge.shape === 'tag' && 'sale-tag rounded-s-sm pe-3',
        badge.style === 'solid' && brand && 'bg-primary text-primary-fg',
        badge.style === 'soft' && 'backdrop-blur-sm',
        badge.style === 'soft' && brand && 'bg-primary-soft text-primary',
        badge.style === 'outline' && 'border-2 bg-surface/90',
        badge.style === 'outline' && brand && 'border-primary text-primary',
        badge.pulse && 'store-pulse',
        className,
      )}
      style={style}
    >
      {/* Only the words take a direction: the corner follows the page's. */}
      <bdi dir={badge.text === 'percent' ? 'ltr' : 'auto'}>{words(badge, sale)}</bdi>
    </span>
  );
}

/** The price of a product or option: the new one, with the old one struck through. */
export function SalePrice({
  sale,
  children,
  className,
  oldClassName,
}: {
  sale: SaleInfo | null;
  /** The price as shown (e.g. "From 1.250 KWD"). */
  children: string;
  className?: string;
  oldClassName?: string;
}) {
  const design = useDesign().sale;
  const money = useMoney();
  const colour = useSalePriceStyle();
  if (!sale) return <span className={className}>{children}</span>;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5" data-sale-price>
      <span className={cn(className, colour.className)} style={colour.style}>
        {children}
      </span>
      {design.oldPrice ? (
        <s className={cn('text-[0.85em] font-normal text-fg-muted', oldClassName)} data-old-price>
          {money(sale.regular)}
        </s>
      ) : null}
    </span>
  );
}

/** "Offer ends in 2 days", from the discount's end. */
export function useEndsIn() {
  const { t, i18n } = useTranslation();
  return (endsAt: string | null, now = Date.now()): string | null => {
    if (!endsAt) return null;
    const ms = Date.parse(endsAt) - now;
    if (!(ms > 0)) return null;
    const format = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
    const minutes = Math.ceil(ms / 60_000);
    const when =
      minutes < 60
        ? format.format(minutes, 'minute')
        : minutes < 24 * 60
          ? format.format(Math.ceil(minutes / 60), 'hour')
          : format.format(Math.ceil(minutes / (24 * 60)), 'day');
    return t('design.saleEnds', { when });
  };
}
