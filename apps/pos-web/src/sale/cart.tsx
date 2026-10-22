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
  parseQuantity,
  priceCart,
} from '@arabat/money';
import { type SaleLine, offerAt, requiredSaleRights } from '@arabat/pos-core';
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';

/** A till item at the price in force now; `regularPrice` while a product discount lowers it. */
export type TillItem = PosCatalogItem & { regularPrice: PosCatalogItem['price'] | null };

/**
 * The catalog's items at the price in force at `now` (product discounts, ADR-0133): the server
 * sends every offer with its dates and sells at the same one, so the till needs no reload when
 * a discount starts or ends.
 */
export function itemsInForce(items: readonly PosCatalogItem[], now: Date): TillItem[] {
  return items.map((i) => {
    const offer = offerAt(
      (i.offers ?? []).map((o) => ({
        ...o,
        priceMinor: Money.fromJSON(o.price as { amount: string; currency: 'KWD' }).minor,
      })),
      now,
    );
    return offer
      ? { ...i, price: offer.price, regularPrice: i.price }
      : { ...i, regularPrice: null };
  });
}

/** The current time, refreshed every 15 seconds (prices of discounts that start or end). */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

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
 * The selling rights this cart needs: the shared rule the server applies
 * (`requiredSaleRights` in `@arabat/pos-core`, BR-177/178/179). What the cashier lacks must come
 * from a supervisor override before the sale completes. Until the company's discount limit is
 * loaded, the limit itself is not checked.
 */
export function requiredRights(
  state: CartState,
  items: Map<string, PosCatalogItem>,
  maxDiscountPercent: string | null,
): OverridablePermission[] {
  try {
    const lines: SaleLine[] = state.lines.map((l) => ({
      variantId: l.variantId,
      quantityMilli: parseQuantity(l.quantity),
      priceOverrideMinor: l.priceOverride !== null ? toMinor(l.priceOverride) : null,
      priceOverrideReason: l.priceOverrideReason,
      discount: toDiscount(l.discount),
      extraMinor: 0n,
    }));
    const catalog = new Map(
      [...items].map(([id, item]) => [
        id,
        {
          priceMinor: Money.fromJSON(item.price as { amount: string; currency: 'KWD' }).minor,
          costMinor: null,
        },
      ]),
    );
    const rights =
      requiredSaleRights(
        lines,
        toDiscount(state.orderDiscount),
        catalog,
        maxDiscountPercent ?? '100',
      ) ?? [];
    return maxDiscountPercent === null
      ? rights.filter((r) => r !== 'sales.discount.override_limit')
      : rights;
  } catch (error) {
    if (error instanceof MoneyError || error instanceof QuantityError) return [];
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
