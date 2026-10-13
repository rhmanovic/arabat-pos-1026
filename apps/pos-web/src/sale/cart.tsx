import type {
  DiscountInput,
  OverridablePermission,
  PosCatalogItem,
  SaleCustomer,
} from '@arabat/contracts';
import {
  type Discount,
  Money,
  MoneyError,
  type PricedCart,
  PricingError,
  QuantityError,
  divideHalfUp,
  exceedsDiscountLimit,
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
  /** Required whenever the price differs from the list price (BR-178). */
  priceOverrideReason: string | null;
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

/**
 * The selling rights this cart needs (the same rules the server applies, BR-177/178/179):
 * what the cashier lacks must come from a supervisor override before the sale completes.
 */
export function requiredRights(
  state: CartState,
  items: Map<string, PosCatalogItem>,
  pricing: PricedCart | null,
  maxDiscountPercent: string | null,
): OverridablePermission[] {
  const rights = new Set<OverridablePermission>();
  const listOf = (l: CartLine) =>
    Money.fromJSON(items.get(l.variantId)!.price as { amount: string; currency: 'KWD' }).minor;
  const changed = (l: CartLine) =>
    l.priceOverride !== null && items.has(l.variantId) && toMinor(l.priceOverride) !== listOf(l);
  if (state.orderDiscount || state.lines.some((l) => l.discount)) rights.add('sales.discount');
  if (state.lines.some(changed)) rights.add('sales.price_override');
  if (pricing && maxDiscountPercent) {
    const over = state.lines.some((l, i) => {
      if (!items.has(l.variantId)) return false;
      const p = pricing.lines[i]!;
      const listGross = divideHalfUp(listOf(l) * parseQuantity(l.quantity), 1000n);
      const gap = listGross > p.grossMinor ? listGross - p.grossMinor : 0n;
      if (changed(l) && toMinor(l.priceOverride!) === 0n) return true;
      return exceedsDiscountLimit(p.lineDiscountMinor + gap, listGross, maxDiscountPercent);
    });
    const orderBase = pricing.subtotalMinor - pricing.lineDiscountsMinor;
    if (over || exceedsDiscountLimit(pricing.orderDiscountMinor, orderBase, maxDiscountPercent))
      rights.add('sales.discount.override_limit');
  }
  if (pricing && pricing.totalMinor === 0n) rights.add('sales.zero_total');
  return [...rights];
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
                priceOverrideReason: null,
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
