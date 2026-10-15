import type {
  AssistantConversation,
  AssistantConversationList,
  AssistantMessage,
  AssistantReply,
  AssistantStatus,
} from '@arabat/contracts';
import { formatDateTime } from '@arabat/i18n';
import { Alert, Button, Spinner, cn } from '@arabat/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AssistantMarkup } from './assistant-markup.js';
import { useErrorMessage } from './components.js';

/**
 * The thread and its browser-generated conversation id: the id changes when the thread is
 * cleared, so the server can group the turns of one conversation (ADR-0105 amendment).
 */
export function useAssistantThread(): {
  thread: AssistantMessage[];
  setThread: (next: AssistantMessage[]) => void;
  conversationId: string;
  /** Reopens a past conversation: its turns and its id, so the next question continues it. */
  load: (conversationId: string, thread: AssistantMessage[]) => void;
} {
  const [state, setState] = useState<{ conversationId: string; thread: AssistantMessage[] }>(
    () => ({ conversationId: crypto.randomUUID(), thread: [] }),
  );
  return {
    thread: state.thread,
    conversationId: state.conversationId,
    setThread: (next) =>
      setState((s) => ({
        conversationId: next.length === 0 ? crypto.randomUUID() : s.conversationId,
        thread: next,
      })),
    load: (conversationId, thread) => setState({ conversationId, thread }),
  };
}

/** A mouse or trackpad is attached (false on phones and tablets, and in jsdom). */
export function hasFinePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches === true;
}

export interface AssistantLabels {
  title: string;
  intro: string;
  disabled: string;
  placeholder: string;
  send: string;
  thinking: string;
  note: string;
  clear: string;
  history: string;
  historyEmpty: string;
  back: string;
}

/**
 * The chat body shared by the cashier and the manager assistants (ADR-0105): the thread lives
 * in the parent so closing and reopening keeps the conversation; the server stores nothing.
 * The parent binds the endpoint and the request context (language, cart or branch).
 */
export function AssistantChat({
  thread,
  onThread,
  onLoad,
  status,
  chat,
  conversations,
  conversation,
  statusKey,
  labels,
  suggestions,
}: {
  thread: AssistantMessage[];
  onThread: (next: AssistantMessage[]) => void;
  /** Reopen a past conversation of the user (from `useAssistantThread().load`). */
  onLoad: (conversationId: string, thread: AssistantMessage[]) => void;
  status: () => Promise<AssistantStatus>;
  chat: (messages: AssistantMessage[]) => Promise<AssistantReply>;
  conversations: () => Promise<AssistantConversationList>;
  conversation: (id: string) => Promise<AssistantConversation>;
  /** Query key of the status probe (one per app surface). */
  statusKey: readonly string[];
  labels: AssistantLabels;
  /** Ready-made questions shown on an empty thread. */
  suggestions: string[];
}) {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const historyKey = [...statusKey.slice(0, -1), 'conversations'];
  const history = useQuery({
    queryKey: historyKey,
    queryFn: conversations,
    enabled: showHistory,
  });
  const reopen = useMutation({
    mutationFn: conversation,
    onSuccess: (c) => {
      onLoad(c.id, c.messages);
      setShowHistory(false);
    },
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const probe = useQuery({ queryKey: statusKey, queryFn: status, staleTime: 5 * 60_000 });
  const ask = useMutation({
    mutationFn: chat,
    onSuccess: (reply, messages) => {
      onThread([...messages, { role: 'assistant', content: reply.reply }]);
      // The list of past conversations now has this one on top.
      void queryClient.invalidateQueries({ queryKey: historyKey });
    },
  });
  const send = (text: string) => {
    const content = text.trim();
    if (!content || ask.isPending) return;
    // The thread is bounded on the wire: keep the latest turns of a long conversation.
    const messages = [...thread, { role: 'user' as const, content }].slice(-20);
    while (messages[0]?.role === 'assistant') messages.shift();
    onThread(messages);
    setDraft('');
    // On a phone, drop the keyboard so the answer has the screen.
    if (!hasFinePointer()) inputRef.current?.blur();
    ask.mutate(messages);
  };
  useEffect(() => {
    // jsdom has no scrollIntoView; browsers do.
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [thread.length, ask.isPending]);
  useEffect(() => {
    // Keyboard users get the box back after each answer; on a phone, focusing would raise
    // the on-screen keyboard over the answer, so the user taps the box when they want it.
    if (!ask.isPending && hasFinePointer()) inputRef.current?.focus();
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
      {showHistory ? (
        <div
          className="min-h-0 flex-1 overflow-y-auto rounded-md bg-surface-muted p-3"
          data-testid="assistant-history"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{labels.history}</h3>
            <button
              type="button"
              className="text-xs underline"
              onClick={() => setShowHistory(false)}
            >
              {labels.back}
            </button>
          </div>
          {history.isPending ? (
            <div className="flex justify-center p-4 text-primary">
              <Spinner label={t('common:status.loading')} />
            </div>
          ) : history.isError ? (
            <Alert tone="danger">{errorMessage(history.error)}</Alert>
          ) : history.data.conversations.length === 0 ? (
            <p className="text-sm text-fg-muted">{labels.historyEmpty}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {history.data.conversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={reopen.isPending}
                    onClick={() => reopen.mutate(c.id)}
                    className="w-full rounded-md bg-surface px-3 py-2 text-start text-sm hover:border-primary border border-transparent"
                  >
                    <span className="line-clamp-2">{c.firstQuestion}</span>
                    <span className="mt-0.5 block text-xs text-fg-muted" dir="auto">
                      {formatDateTime(c.lastAt, i18n.language)} · {c.turns}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {reopen.isError ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {errorMessage(reopen.error)}
            </p>
          ) : null}
        </div>
      ) : null}
      <div
        hidden={showHistory}
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
            {m.role === 'user' ? (
              <p className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-fg">
                {m.content}
              </p>
            ) : (
              <div className="max-w-[85%] rounded-lg bg-surface px-3 py-2 text-sm leading-relaxed text-fg">
                <AssistantMarkup text={m.content} />
              </div>
            )}
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
      <div className="flex items-center justify-between gap-3 text-xs text-fg-muted">
        <span className="min-w-0">{labels.note}</span>
        <span className="flex shrink-0 gap-3">
          {enabled ? (
            <button type="button" className="underline" onClick={() => setShowHistory((v) => !v)}>
              {labels.history}
            </button>
          ) : null}
          {thread.length > 0 ? (
            <button
              type="button"
              className="underline"
              onClick={() => {
                ask.reset();
                onThread([]);
              }}
            >
              {labels.clear}
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
