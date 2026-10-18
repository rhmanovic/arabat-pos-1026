import type { OfferItemIcon } from '@arabat/contracts';
import type { ReactNode } from 'react';
import { ItemIllustration } from './illustrations.js';
import { Reveal } from './reveal.js';

/**
 * The "your complete system" card: shown as the first step of the pricing page and on the
 * homepage under the steps, so both pages present the subscription the same way.
 */
export function SystemCard({
  title,
  text,
  price,
  currency,
  perYear,
  includes,
  icon = 'system',
  imageUrl,
  badge,
  action,
  className = 'shadow-sm',
}: {
  title: string;
  text: string;
  /** Display amount (already shortened), or null while the offer loads. */
  price: string | null;
  currency: string;
  perYear: string;
  includes: readonly string[];
  icon?: OfferItemIcon;
  imageUrl?: string | null;
  badge?: ReactNode;
  action: ReactNode;
  /** Elevation; on a white section the card needs a border and a stronger shadow. */
  className?: string;
}) {
  return (
    <div className={`rounded-3xl bg-white p-6 text-start sm:p-10 ${className}`}>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="size-28 rounded-2xl object-cover" />
        ) : (
          <ItemIllustration icon={icon} className="size-28 shrink-0" />
        )}
        <div className="flex-1">
          <h2 className="text-2xl font-bold sm:text-3xl">{title}</h2>
          <p className="mt-2 text-muted">{text}</p>
        </div>
        {price ? (
          <div className="text-start sm:text-end">
            <p className="text-3xl font-bold tabular-nums text-brand" dir="ltr">
              {price} <span className="text-base">{currency}</span>
            </p>
            <p className="text-sm text-muted">{perYear}</p>
          </div>
        ) : null}
      </div>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {includes.map((line, index) => (
          <Reveal as="li" key={line} delay={index * 0.05} className="flex items-start gap-3">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-sm text-brand">
              ✓
            </span>
            <span className="text-ink">{line}</span>
          </Reveal>
        ))}
      </ul>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-black/5 pt-6">
        {badge ? (
          <span className="rounded-full bg-brand-soft px-4 py-1.5 text-sm font-medium text-brand">
            ✓ {badge}
          </span>
        ) : (
          <span />
        )}
        {action}
      </div>
    </div>
  );
}
