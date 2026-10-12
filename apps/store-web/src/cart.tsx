import { DEFAULT_CURRENCY, Money } from '@arabat/money';
import type { StoreProduct, Storefront } from '@arabat/contracts';
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';

/** One cart line. Prices are never stored: they are always read from the current catalog. */
export interface CartLine {
  variantId: string;
  productId: string;
  quantity: number;
}

interface CartState {
  lines: CartLine[];
  add: (line: CartLine, max: number) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
  count: number;
}

const CartContext = createContext<CartState | null>(null);
const storageKey = (slug: string) => `arabat.cart.${slug}`;

function load(slug: string): CartLine[] {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(slug));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is CartLine =>
        typeof l === 'object' &&
        l !== null &&
        typeof (l as CartLine).variantId === 'string' &&
        typeof (l as CartLine).productId === 'string' &&
        Number.isInteger((l as CartLine).quantity) &&
        (l as CartLine).quantity > 0,
    );
  } catch {
    return [];
  }
}

/** Cart of one store, kept in this browser only (per store slug). */
export function CartProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => load(slug));
  const update = useCallback(
    (next: (current: CartLine[]) => CartLine[]) =>
      setLines((current) => {
        const value = next(current).filter((l) => l.quantity > 0);
        try {
          globalThis.localStorage?.setItem(storageKey(slug), JSON.stringify(value));
        } catch {
          // Storage unavailable: the cart still works for this page view.
        }
        return value;
      }),
    [slug],
  );
  const value = useMemo<CartState>(
    () => ({
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      add: (line, max) =>
        update((current) => {
          const existing = current.find((l) => l.variantId === line.variantId);
          if (!existing) return [...current, { ...line, quantity: Math.min(line.quantity, max) }];
          return current.map((l) =>
            l.variantId === line.variantId
              ? { ...l, quantity: Math.min(l.quantity + line.quantity, max) }
              : l,
          );
        }),
      setQuantity: (variantId, quantity) =>
        update((current) =>
          current.map((l) => (l.variantId === variantId ? { ...l, quantity } : l)),
        ),
      remove: (variantId) => update((current) => current.filter((l) => l.variantId !== variantId)),
      clear: () => update(() => []),
    }),
    [lines, update],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const cart = useContext(CartContext);
  if (!cart) throw new Error('useCart must be used inside <CartProvider>');
  return cart;
}

/** Wire money → exact Money (the API only sends KWD-style decimal strings). */
export const toMoney = (value: { amount: string; currency: string }) =>
  Money.fromJSON(value as { amount: string; currency: 'KWD' });

export interface PricedLine extends CartLine {
  product: StoreProduct;
  variant: StoreProduct['variants'][number];
  unitPrice: Money;
  lineTotal: Money;
}

/**
 * Prices the cart against the current catalog with exact decimal money (no floats). Lines
 * whose item is no longer listed or sold out are returned in `missing`. The server prices
 * the order again and refuses it if the total the shopper saw changed (TOTAL_CHANGED).
 */
export function priceLines(
  lines: CartLine[],
  products: StoreProduct[],
  store: Pick<Storefront, 'deliveryFee'>,
  fulfillment: 'pickup' | 'delivery',
) {
  const priced: PricedLine[] = [];
  const missing: CartLine[] = [];
  for (const line of lines) {
    const product = products.find((p) => p.productId === line.productId);
    const variant = product?.variants.find((v) => v.variantId === line.variantId);
    if (!product || !variant || !variant.available) {
      missing.push(line);
      continue;
    }
    const unitPrice = toMoney(variant.price);
    priced.push({
      ...line,
      quantity: Math.min(line.quantity, variant.maxQuantity),
      product,
      variant,
      unitPrice,
      lineTotal: unitPrice.multiply(String(Math.min(line.quantity, variant.maxQuantity))),
    });
  }
  const currency = priced[0]?.unitPrice.currency ?? DEFAULT_CURRENCY;
  const subtotal = priced.reduce((sum, l) => sum.add(l.lineTotal), Money.zero(currency));
  const deliveryFee =
    fulfillment === 'delivery' ? toMoney(store.deliveryFee) : Money.zero(currency);
  return { priced, missing, subtotal, deliveryFee, total: subtotal.add(deliveryFee) };
}
