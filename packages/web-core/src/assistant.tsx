import type { AssistantMessage, AssistantReply, AssistantStatus } from '@arabat/contracts';
import { Alert, Button, Spinner, cn } from '@arabat/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useErrorMessage } from './components.js';

export interface AssistantLabels {
  title: string;
  intro: string;
  disabled: string;
  placeholder: string;
  send: string;
  thinking: string;
  note: string;
  clear: string;
}

/**
 * The chat body shared by the cashier and the manager assistants (ADR-0105): the thread lives
 * in the parent so closing and reopening keeps the conversation; the server stores nothing.
 * The parent binds the endpoint and the request context (language, cart or branch).
 */
export function AssistantChat({
  thread,
  onThread,
  status,
  chat,
  statusKey,
  labels,
  suggestions,
}: {
  thread: AssistantMessage[];
  onThread: (next: AssistantMessage[]) => void;
  status: () => Promise<AssistantStatus>;
  chat: (messages: AssistantMessage[]) => Promise<AssistantReply>;
  /** Query key of the status probe (one per app surface). */
  statusKey: readonly string[];
  labels: AssistantLabels;
  /** Ready-made questions shown on an empty thread. */
  suggestions: string[];
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const probe = useQuery({ queryKey: statusKey, queryFn: status, staleTime: 5 * 60_000 });
  const ask = useMutation({
    mutationFn: chat,
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
  const enabled = probe.data?.enabled === true;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {probe.isPending ? (
        <div className="flex justify-center p-4 text-primary">
          <Spinner label={t('common:status.loading')} />
        </div>
      ) : null}
      {probe.data && !enabled ? (
        <Alert tone="warning" data-testid="assistant-disabled">
          {labels.disabled}
        </Alert>
      ) : null}
      {probe.isError ? <Alert tone="danger">{errorMessage(probe.error)}</Alert> : null}
      <div
        role="log"
        aria-label={labels.title}
        aria-live="polite"
        className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-md bg-surface-muted p-3"
      >
        {thread.length === 0 ? (
          <div className="space-y-3 text-sm text-fg-muted">
            <p>{labels.intro}</p>
            {enabled ? (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-fg hover:border-primary"
                  >
                    {s}
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
              {labels.thinking}
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
          aria-label={labels.placeholder}
          placeholder={labels.placeholder}
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
          {labels.send}
        </Button>
      </form>
      <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
        <span>{labels.note}</span>
        {thread.length > 0 ? (
          <button
            type="button"
            className="shrink-0 underline"
            onClick={() => {
              ask.reset();
              onThread([]);
            }}
          >
            {labels.clear}
          </button>
        ) : null}
      </div>
    </div>
  );
}
