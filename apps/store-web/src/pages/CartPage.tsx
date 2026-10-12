import { Alert, Button, EmptyState, Spinner } from '@arabat/ui';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { priceLines, toMoney, useCart } from '../cart.js';
import { useLocalName, useMoney, useSlug, useStoreProducts, useStorefront } from '../shared.js';

export function CartPage() {
  const slug = useSlug();
  const cart = useCart();
  const products = useStoreProducts();
  const { data: store } = useStorefront();
  const name = useLocalName();
  const money = useMoney();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const priced =
    products.data && store ? priceLines(cart.lines, products.data.products, store, 'pickup') : null;
  const missing = priced?.missing.length ?? 0;

  // Sold-out or unlisted items leave the cart (the shopper is told below).
  useEffect(() => {
    if (priced && missing > 0) for (const l of priced.missing) cart.remove(l.variantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing]);

  if (products.isPending || !store) return <Spinner label={t('common:status.loading')} />;
  if (!priced || (priced.priced.length === 0 && missing === 0))
    return (
      <EmptyState
        title={t('cart.empty')}
        action={
          <Link to={`/${slug}`} className="text-primary hover:underline">
            {t('cart.browse')}
          </Link>
        }
      />
    );
  const minimum = toMoney(store.minimumOrder);
  const belowMinimum = priced.subtotal.compare(minimum) < 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('cart.title')}</h1>
      {missing > 0 ? <Alert tone="warning">{t('cart.gone')}</Alert> : null}
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {priced.priced.map((l) => {
          const label = [name(l.product), name(l.variant)].filter(Boolean).join(' — ');
          return (
            <li key={l.variantId} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{label}</p>
                <p className="text-sm tabular-nums text-fg-muted">{money(l.unitPrice)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label={t('cart.decrease', { name: label })}
                  onClick={() => cart.setQuantity(l.variantId, l.quantity - 1)}
                >
                  −
                </Button>
                <span className="w-8 text-center tabular-nums" data-testid="cart-qty">
                  {l.quantity}
                </span>
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label={t('cart.increase', { name: label })}
                  disabled={l.quantity >= l.variant.maxQuantity}
                  onClick={() => cart.setQuantity(l.variantId, l.quantity + 1)}
                >
                  +
                </Button>
              </div>
              <p className="w-28 text-end font-medium tabular-nums">{money(l.lineTotal)}</p>
              <Button variant="ghost" size="sm" onClick={() => cart.remove(l.variantId)}>
                {t('cart.remove')}
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col items-end gap-2">
        <p className="text-lg">
          {t('cart.subtotal')}:{' '}
          <span className="font-semibold tabular-nums">{money(priced.subtotal)}</span>
        </p>
        {belowMinimum ? (
          <p className="text-sm text-danger">{t('cart.minimum', { amount: money(minimum) })}</p>
        ) : null}
        <Button
          size="lg"
          disabled={belowMinimum || !store.acceptingOrders || priced.priced.length === 0}
          onClick={() => void navigate(`/${slug}/checkout`)}
        >
          {t('cart.checkout')}
        </Button>
      </div>
    </div>
  );
}
