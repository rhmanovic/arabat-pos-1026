import type { AssistantCart } from '@arabat/contracts';
import { Money } from '@arabat/money';
import { Dialog } from '@arabat/ui';
import { AssistantChat, type AssistantThread, useApi } from '@arabat/web-core';
import { useTranslation } from 'react-i18next';

const SUGGESTIONS = ['hold', 'discount', 'returns', 'shortcuts'] as const;

/**
 * Chat helper for the cashier (ADR-0105): the active conversation lives in the parent so
 * closing and reopening the dialog keeps it; the record of every conversation is on the server.
 */
export function AssistantDialog({
  state,
  cart,
  onClose,
}: {
  state: AssistantThread;
  cart: AssistantCart | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('assistant.title')} size="lg">
      <div className="flex h-[70dvh] min-h-72 flex-col">
        <AssistantChat
          state={state}
          statusKey={['pos', 'assistant', 'status']}
          status={() => api.assistant.status()}
          conversations={() => api.assistant.conversations()}
          conversation={(id) => api.assistant.conversation(id)}
          chat={(messages) =>
            api.assistant.chat({
              messages,
              language: i18n.resolvedLanguage === 'en' ? 'en' : 'ar',
              cart,
              conversationId: state.conversationId,
            })
          }
          labels={{
            title: t('assistant.title'),
            intro: t('assistant.intro'),
            disabled: t('assistant.disabled'),
            placeholder: t('assistant.placeholder'),
            send: t('assistant.send'),
            thinking: t('assistant.thinking'),
            note: t('assistant.note'),
            newChat: t('assistant.clear'),
            conversations: t('assistant.history'),
            historyEmpty: t('assistant.historyEmpty'),
            back: t('assistant.back'),
          }}
          suggestions={SUGGESTIONS.map((s) => t(`assistant.suggestions.${s}`))}
        />
      </div>
    </Dialog>
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
