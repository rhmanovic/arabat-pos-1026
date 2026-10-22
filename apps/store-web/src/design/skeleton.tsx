import { cn } from '@arabat/ui';
import { useTranslation } from 'react-i18next';

/*
 * Placeholders while the storefront loads: the page's outline instead of a blank screen, and
 * product cards of the real list's size, so nothing jumps when the products arrive.
 */

const block = 'animate-pulse rounded-lg bg-surface-muted';

/** Cards in the shape of a product list while it loads. */
export function ProductGridSkeleton({
  columns = 4,
  mobileColumns = 2,
  count = 8,
  list = false,
}: {
  columns?: number;
  mobileColumns?: 1 | 2;
  count?: number;
  list?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ul
      aria-busy="true"
      aria-label={t('common:status.loading')}
      data-testid="products-loading"
      className={cn(
        'grid gap-3',
        list
          ? 'sm:grid-cols-2'
          : cn(
              mobileColumns === 1 ? 'grid-cols-1' : 'grid-cols-2',
              { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-3 lg:grid-cols-4' }[
                columns
              ] ?? 'sm:grid-cols-3 lg:grid-cols-4',
            ),
      )}
    >
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={cn('flex gap-3', list ? 'items-center' : 'flex-col')}>
          <span className={cn(block, list ? 'size-20 shrink-0' : 'aspect-square w-full')} />
          <span className="flex w-full flex-col gap-2">
            <span className={cn(block, 'h-3.5 w-3/4')} />
            <span className={cn(block, 'h-3 w-1/3')} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The page's outline (header, a large block, a row of cards) while the store loads. */
export function StoreSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      className="flex min-h-dvh flex-col bg-canvas"
      aria-busy="true"
      aria-label={t('common:status.loading')}
      data-testid="store-loading"
    >
      <div className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <span className={cn(block, 'h-8 w-28')} />
          <span className="flex gap-2 max-sm:hidden">
            <span className={cn(block, 'h-4 w-16')} />
            <span className={cn(block, 'h-4 w-16')} />
            <span className={cn(block, 'h-4 w-16')} />
          </span>
          <span className={cn(block, 'size-9 rounded-full')} />
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4">
        <span className={cn(block, 'aspect-[16/9] w-full rounded-2xl sm:aspect-[3/1]')} />
        <span className={cn(block, 'h-5 w-40')} />
        <ProductGridSkeleton count={4} />
      </div>
    </div>
  );
}
