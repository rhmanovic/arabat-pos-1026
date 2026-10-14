import type { AssistantCart, AssistantMessage } from '@arabat/contracts';
import { Money } from '@arabat/money';
import { Alert, Button, Dialog, Spinner, cn } from '@arabat/ui';
import { useApi, useErrorMessage } from '@arabat/web-core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const SUGGESTIONS = ['hold', 'discount', 'returns', 'shortcuts'] as const;

/**
 * Chat helper for the cashier (ADR-0105): the thread lives in the parent so closing and
 * reopening the dialog keeps the conversation; the server stores nothing.
 */
export function AssistantDialog({
  thread,
  onThread,
  cart,
  onClose,
}: {
  thread: AssistantMessage[];
  onThread: (next: AssistantMessage[]) => void;
  cart: AssistantCart | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const errorMessage = useErrorMessage();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const status = useQuery({
    queryKey: ['pos', 'assistant', 'status'],
    queryFn: () => api.assistant.status(),
    staleTime: 5 * 60_000,
  });
  const ask = useMutation({
    mutationFn: (messages: AssistantMessage[]) =>
      api.assistant.chat({
        messages,
        language: i18n.resolvedLanguage === 'en' ? 'en' : 'ar',
        cart,
      }),
    onSuccess: (reply, messages) =>
      onThread([...messages, { role: 'assistant', content: reply.reply }]),
  });
  const send = (text: string) => {
    const content = text.trim();
    if (!content || ask.isPending) return;
    // The thread is bounded on the wire: keep the latest turns of a long conversation.
    const messages = [...thread, { role: 'user' as const, content }].slice(-20);
    while (messages[0]?.role === 'assistant') messages.shift();
    onThread(messages);
    setDraft('');
    ask.mutate(messages);
  };
  useEffect(() => {
    // jsdom has no scrollIntoView; browsers do.
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [thread.length, ask.isPending]);
  useEffect(() => {
    if (!ask.isPending) inputRef.current?.focus();
  }, [ask.isPending]);
  const enabled = status.data?.enabled === true;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('assistant.title')} size="md">
      <div className="flex h-[60dvh] min-h-64 flex-col gap-3">
        {status.isPending ? (
          <div className="flex justify-center p-4 text-primary">
            <Spinner label={t('common:status.loading')} />
          </div>
        ) : null}
        {status.data && !enabled ? (
          <Alert tone="warning" data-testid="assistant-disabled">
            {t('assistant.disabled')}
          </Alert>
        ) : null}
        {status.isError ? <Alert tone="danger">{errorMessage(status.error)}</Alert> : null}
        <div
          role="log"
          aria-label={t('assistant.title')}
          aria-live="polite"
          className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-md bg-surface-muted p-3"
        >
          {thread.length === 0 ? (
            <div className="space-y-3 text-sm text-fg-muted">
              <p>{t('assistant.intro')}</p>
              {enabled ? (
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(t(`assistant.suggestions.${s}`))}
                      className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-fg hover:border-primary"
                    >
                      {t(`assistant.suggestions.${s}`)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {thread.map((m, i) => (
            <div
              key={i}
              className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
              data-testid={`assistant-${m.role}`}
            >
              <p
                className={cn(
                  'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                  m.role === 'user' ? 'bg-primary text-primary-fg' : 'bg-surface text-fg',
                )}
              >
                {m.content}
              </p>
            </div>
          ))}
          {ask.isPending ? (
            <div className="flex justify-start">
              <p className="rounded-lg bg-surface px-3 py-2 text-sm text-fg-muted">
                {t('assistant.thinking')}
              </p>
            </div>
          ) : null}
          {ask.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(ask.error)}
            </p>
          ) : null}
          <div ref={endRef} />
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <input
            ref={inputRef}
            type="text"
            aria-label={t('assistant.placeholder')}
            placeholder={t('assistant.placeholder')}
            autoComplete="off"
            maxLength={2000}
            disabled={!enabled || ask.isPending}
            className="h-11 w-full min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-base outline-none focus:border-primary disabled:bg-surface-muted"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button
            type="submit"
            className="h-11 shrink-0"
            disabled={!enabled || !draft.trim()}
            loading={ask.isPending}
          >
            {t('assistant.send')}
          </Button>
        </form>
        <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
          <span>{t('assistant.note')}</span>
          {thread.length > 0 ? (
            <button
              type="button"
              className="shrink-0 underline"
              onClick={() => {
                ask.reset();
                onThread([]);
              }}
            >
              {t('assistant.clear')}
            </button>
          ) : null}
        </div>
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
