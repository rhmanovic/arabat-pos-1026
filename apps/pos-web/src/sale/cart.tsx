import type { DiscountInput, PosCatalogItem, SaleCustomer } from '@arabat/contracts';
import {
  type Discount,
  Money,
  MoneyError,
  type PricedCart,
  PricingError,
  QuantityError,
  parseQuantity,
  priceCart,
} from '@arabat/money';
import { type ReactNode, createContext, useContext, useMemo, useState } from 'react';

export interface CartLine {
  key: string;
  variantId: string;
  /** Decimal string, e.g. "2" or "1.250". */
  quantity: string;
  priceOverride: string | null;
  discount: DiscountInput | null;
}

interface CartState {
  lines: CartLine[];
  orderDiscount: DiscountInput | null;
  /** Set when a suspended order was resumed: checkout completes it. */
  orderId: string | null;
  /** Registered customer, or null for a walk-in sale. */
  customer: SaleCustomer | null;
}

const EMPTY: CartState = { lines: [], orderDiscount: null, orderId: null, customer: null };

function toMinor(value: string): bigint {
  return Money.parse(value, 'KWD').minor;
}

function toDiscount(d: DiscountInput | null): Discount | null {
  if (!d) return null;
  return d.type === 'percent'
    ? { type: 'percent', percent: d.value }
    : { type: 'amount', amountMinor: toMinor(d.value) };
}

export type CartPricing =
  { ok: true; cart: PricedCart } | { ok: false; line: number | null; message: string };

/** Prices the cart with the same function the server uses (display only). */
export function priceLines(state: CartState, items: Map<string, PosCatalogItem>): CartPricing {
  try {
    return {
      ok: true,
      cart: priceCart(
        state.lines.map((l) => ({
          unitPriceMinor:
            l.priceOverride !== null
              ? toMinor(l.priceOverride)
              : Money.fromJSON(items.get(l.variantId)!.price as { amount: string; currency: 'KWD' })
                  .minor,
          quantityMilli: parseQuantity(l.quantity),
          discount: toDiscount(l.discount),
        })),
        toDiscount(state.orderDiscount),
      ),
    };
  } catch (error) {
    if (error instanceof PricingError) return { ok: false, line: error.line, message: error.code };
    if (error instanceof MoneyError) return { ok: false, line: null, message: 'INVALID_PRICE' };
    if (error instanceof QuantityError)
      return { ok: false, line: null, message: 'INVALID_QUANTITY' };
    throw error;
  }
}

function useCartState() {
  const [state, setState] = useState<CartState>(EMPTY);
  return useMemo(
    () => ({
      state,
      add(variantId: string, quantity = '1') {
        setState((s) => {
          const existing = s.lines.find(
            (l) => l.variantId === variantId && l.priceOverride === null && l.discount === null,
          );
          if (existing) {
            const next = parseQuantity(existing.quantity) + parseQuantity(quantity);
            return {
              ...s,
              lines: s.lines.map((l) =>
                l.key === existing.key ? { ...l, quantity: formatQty(next) } : l,
              ),
            };
          }
          return {
            ...s,
            lines: [
              ...s.lines,
              {
                key: crypto.randomUUID(),
                variantId,
                quantity,
                priceOverride: null,
                discount: null,
              },
            ],
          };
        });
      },
      update(key: string, patch: Partial<CartLine>) {
        setState((s) => ({
          ...s,
          lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)),
        }));
      },
      remove(key: string) {
        setState((s) => ({ ...s, lines: s.lines.filter((l) => l.key !== key) }));
      },
      setOrderDiscount(orderDiscount: DiscountInput | null) {
        setState((s) => ({ ...s, orderDiscount }));
      },
      setCustomer(customer: SaleCustomer | null) {
        setState((s) => ({ ...s, customer }));
      },
      load(next: CartState) {
        setState(next);
      },
      clear() {
        setState(EMPTY);
      },
    }),
    [state],
  );
}

export function formatQty(milli: bigint): string {
  const whole = milli / 1000n;
  const frac = milli % 1000n;
  return frac === 0n
    ? whole.toString()
    : `${whole}.${frac.toString().padStart(3, '0').replace(/0+$/, '')}`;
}

type CartApi = ReturnType<typeof useCartState>;
const CartContext = createContext<CartApi | null>(null);

/** The current sale lives above the routes, so visiting the shift screen keeps the cart. */
export function CartProvider({ children }: { children: ReactNode }) {
  const cart = useCartState();
  return <CartContext.Provider value={cart}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside <CartProvider>');
  return value;
}
