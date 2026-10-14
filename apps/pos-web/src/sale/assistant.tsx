import type { AssistantCart, AssistantMessage } from '@arabat/contracts';
import { Money } from '@arabat/money';
import { Dialog } from '@arabat/ui';
import { AssistantChat, useApi } from '@arabat/web-core';
import { useTranslation } from 'react-i18next';

const SUGGESTIONS = ['hold', 'discount', 'returns', 'shortcuts'] as const;

/**
 * Chat helper for the cashier (ADR-0105): the thread lives in the parent so closing and
 * reopening the dialog keeps the conversation; the server stores nothing.
 */
export function AssistantDialog({
  thread,
  onThread,
  conversationId,
  cart,
  onClose,
}: {
  thread: AssistantMessage[];
  onThread: (next: AssistantMessage[]) => void;
  conversationId: string;
  cart: AssistantCart | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('assistant.title')} size="md">
      <div className="flex h-[60dvh] min-h-64 flex-col">
        <AssistantChat
          thread={thread}
          onThread={onThread}
          statusKey={['pos', 'assistant', 'status']}
          status={() => api.assistant.status()}
          chat={(messages) =>
            api.assistant.chat({
              messages,
              language: i18n.resolvedLanguage === 'en' ? 'en' : 'ar',
              cart,
              conversationId,
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
            clear: t('assistant.clear'),
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
