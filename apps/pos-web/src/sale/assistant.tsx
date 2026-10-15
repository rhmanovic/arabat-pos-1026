import type { AssistantCart } from '@arabat/contracts';
import { Money } from '@arabat/money';
import { AssistantLauncher, assistantLabels, useApi } from '@arabat/web-core';
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const SUGGESTIONS = ['hold', 'discount', 'returns', 'shortcuts'] as const;

/**
 * What is on the till, as display text, for the assistant's context: the sale screen sets it
 * (it alone knows the catalog names and the priced lines); the launcher in the layout reads it.
 */
const CartContext = createContext<{
  cart: AssistantCart | null;
  setCart: (cart: AssistantCart | null) => void;
} | null>(null);

export function AssistantCartProvider({ children }: { children: ReactNode }) {
  const [cart, setState] = useState<AssistantCart | null>(null);
  // Stable setter: the sale screen's effects depend on it, and it recomputes the text on
  // every render, so only a real change may re-render anything.
  const setCart = useCallback(
    (next: AssistantCart | null) =>
      setState((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next)),
    [],
  );
  const value = useMemo(() => ({ cart, setCart }), [cart, setCart]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useAssistantCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useAssistantCart needs AssistantCartProvider');
  return ctx;
}

/** The cashier's assistant (ADR-0105): the shared launcher bound to the POS endpoints, F9. */
export function PosAssistant() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { cart } = useAssistantCart();
  return (
    <AssistantLauncher
      id="pos-assistant"
      hotkey="F9"
      bindings={{
        statusKey: ['pos', 'assistant', 'status'],
        status: () => api.assistant.status(),
        conversations: () => api.assistant.conversations(),
        conversation: (id) => api.assistant.conversation(id),
        chat: (messages, conversationId) =>
          api.assistant.chat({
            messages,
            language: i18n.resolvedLanguage === 'en' ? 'en' : 'ar',
            cart,
            conversationId,
          }),
      }}
      labels={assistantLabels(t)}
      suggestions={SUGGESTIONS.map((s) => t(`assistant.suggestions.${s}`))}
    />
  );
}

/** The cart as display text for the assistant's context (names, quantities, prices). */
export function describeCart(
  lines: { name: string; quantity: string; unitPriceMinor: bigint; netMinor: bigint }[],
  totalMinor: bigint | null,
  customer: string | null,
): AssistantCart | null {
  if (lines.length === 0) return null;
  const amount = (minor: bigint) => Money.ofMinor(minor, 'KWD').toDecimalString();
  return {
    lines: lines.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      unitPrice: amount(l.unitPriceMinor),
      lineTotal: amount(l.netMinor),
    })),
    total: totalMinor === null ? null : amount(totalMinor),
    customer,
  };
}
