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

/** A conversation whose last turn is this recent is resumed when the chat opens. */
export const RESUME_WITHIN_MS = 30 * 60_000;

/**
 * The active conversation (ADR-0107 amendment): the turns on screen and the id the server
 * groups them under. Nothing is stored in the browser: the record lives on the server, and
 * the chat resumes the user's latest conversation from there when it opens.
 */
export function useAssistantThread(): {
  thread: AssistantMessage[];
  setThread: (next: AssistantMessage[]) => void;
  conversationId: string;
  /** Shows a past conversation: its turns and its id, so the next question continues it. */
  load: (conversationId: string, thread: AssistantMessage[]) => void;
  /** Starts an empty conversation under a new id. */
  startNew: () => void;
  /** True until the user has chosen a conversation or started one: the chat may resume. */
  untouched: boolean;
} {
  const [state, setState] = useState<{
    conversationId: string;
    thread: AssistantMessage[];
    untouched: boolean;
  }>(() => ({ conversationId: crypto.randomUUID(), thread: [], untouched: true }));
  return {
    thread: state.thread,
    conversationId: state.conversationId,
    untouched: state.untouched,
    setThread: (next) => setState((s) => ({ ...s, thread: next, untouched: false })),
    load: (conversationId, thread) => setState({ conversationId, thread, untouched: false }),
    startNew: () => setState({ conversationId: crypto.randomUUID(), thread: [], untouched: false }),
  };
}

/** A mouse or trackpad is attached (false on phones and tablets, and in jsdom). */
export function hasFinePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches === true;
}

/** A touch screen is the main pointer (phones and tablets; false in jsdom). */
export function hasCoarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
}

export interface AssistantLabels {
  title: string;
  intro: string;
  disabled: string;
  placeholder: string;
  send: string;
  thinking: string;
  note: string;
  newChat: string;
  conversations: string;
  historyEmpty: string;
  back: string;
}

export type AssistantThread = ReturnType<typeof useAssistantThread>;

/**
 * The chat shared by the cashier and the manager assistants, laid out like a chat app: the
 * user's conversations down the side (newest first, from the server), the active one in the
 * middle, a composer below. The parent binds the endpoints and the request context.
 */
export function AssistantChat({
  state,
  status,
  chat,
  conversations,
  conversation,
  statusKey,
  labels,
  suggestions,
}: {
  state: AssistantThread;
  status: () => Promise<AssistantStatus>;
  chat: (messages: AssistantMessage[]) => Promise<AssistantReply>;
  conversations: () => Promise<AssistantConversationList>;
  conversation: (id: string) => Promise<AssistantConversation>;
  /** Query key of the status probe (one per app surface). */
  statusKey: readonly string[];
  labels: AssistantLabels;
  /** Ready-made questions shown on an empty conversation. */
  suggestions: string[];
}) {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const { thread, conversationId, setThread, load, startNew, untouched } = state;
  const [draft, setDraft] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const listKey = [...statusKey.slice(0, -1), 'conversations'];
  const probe = useQuery({ queryKey: statusKey, queryFn: status, staleTime: 5 * 60_000 });
  const enabled = probe.data?.enabled === true;
  const list = useQuery({ queryKey: listKey, queryFn: conversations, enabled });
  const open = useMutation({
    mutationFn: conversation,
    onSuccess: (c) => {
      load(c.id, c.messages);
      setListOpen(false);
    },
  });
  const ask = useMutation({
    mutationFn: chat,
    onSuccess: (reply, messages) => {
      setThread([...messages, { role: 'assistant', content: reply.reply }]);
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });

  // Opening the chat resumes the conversation the user was in a moment ago (server record).
  const latest = list.data?.conversations[0];
  const { mutate: reopen } = open;
  useEffect(() => {
    if (!untouched || !latest) return;
    if (Date.now() - new Date(latest.lastAt).getTime() <= RESUME_WITHIN_MS) reopen(latest.id);
  }, [untouched, latest, reopen]);

  const send = (text: string) => {
    const content = text.trim();
    if (!content || ask.isPending) return;
    // The thread is bounded on the wire: keep the latest turns of a long conversation.
    const messages = [...thread, { role: 'user' as const, content }].slice(-20);
    while (messages[0]?.role === 'assistant') messages.shift();
    setThread(messages);
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

  const newChat = () => {
    ask.reset();
    startNew();
    setListOpen(false);
  };

  const sidebar = (
    <nav
      aria-label={labels.conversations}
      className={cn(
        'flex min-h-0 flex-col gap-2 sm:w-52 sm:shrink-0 sm:border-e sm:border-border sm:pe-3',
        listOpen ? 'flex-1' : 'max-sm:hidden',
      )}
    >
      <Button variant="secondary" size="sm" className="w-full" onClick={newChat}>
        ＋ {labels.newChat}
      </Button>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.isPending && enabled ? (
          <div className="flex justify-center p-4 text-primary">
            <Spinner label={t('common:status.loading')} />
          </div>
        ) : list.isError ? (
          <Alert tone="danger">{errorMessage(list.error)}</Alert>
        ) : !list.data || list.data.conversations.length === 0 ? (
          <p className="px-2 py-3 text-xs text-fg-muted">{labels.historyEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {list.data.conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={c.id === conversationId ? 'true' : undefined}
                  disabled={open.isPending}
                  onClick={() => (c.id === conversationId ? setListOpen(false) : open.mutate(c.id))}
                  className={cn(
                    'w-full rounded-md px-2 py-1.5 text-start text-sm hover:bg-surface-muted',
                    c.id === conversationId && 'bg-primary-soft text-primary',
                  )}
                >
                  <span className="line-clamp-2">{c.firstQuestion}</span>
                  <span className="mt-0.5 block text-xs text-fg-muted" dir="auto">
                    {formatDateTime(c.lastAt, i18n.language)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {open.isError ? (
          <p role="alert" className="mt-2 text-xs text-danger">
            {errorMessage(open.error)}
          </p>
        ) : null}
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {probe.data && !enabled ? (
        <Alert tone="warning" data-testid="assistant-disabled">
          {labels.disabled}
        </Alert>
      ) : null}
      {probe.isError ? <Alert tone="danger">{errorMessage(probe.error)}</Alert> : null}
      {/* Phones: one row to switch between the list and the conversation. */}
      <div className="flex items-center justify-between gap-2 sm:hidden">
        <button
          type="button"
          className="text-sm underline"
          onClick={() => setListOpen((v) => !v)}
          aria-expanded={listOpen}
        >
          {listOpen ? labels.back : labels.conversations}
        </button>
        {!listOpen ? (
          <button type="button" className="text-sm underline" onClick={newChat}>
            ＋ {labels.newChat}
          </button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 gap-3">
        {sidebar}
        <div
          role="log"
          aria-label={labels.title}
          aria-live="polite"
          className={cn(
            'min-h-0 flex-1 space-y-3 overflow-y-auto rounded-md bg-surface-muted p-3',
            listOpen && 'max-sm:hidden',
          )}
        >
          {probe.isPending ? (
            <div className="flex justify-center p-4 text-primary">
              <Spinner label={t('common:status.loading')} />
            </div>
          ) : null}
          {thread.length === 0 && !open.isPending ? (
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
          {open.isPending ? (
            <div className="flex justify-center p-4 text-primary">
              <Spinner label={t('common:status.loading')} />
            </div>
          ) : null}
          {thread.map((m, i) => (
            <div
              key={i}
              className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
              data-testid={`assistant-${m.role}`}
            >
              {m.role === 'user' ? (
                <p className="max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-fg">
                  {m.content}
                </p>
              ) : (
                <div className="flex max-w-[92%] gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs text-primary-fg"
                  >
                    ✦
                  </span>
                  <div className="min-w-0 text-sm leading-relaxed text-fg">
                    <AssistantMarkup text={m.content} />
                  </div>
                </div>
              )}
            </div>
          ))}
          {ask.isPending ? (
            <div className="flex justify-start">
              <p className="rounded-2xl bg-surface px-3 py-2 text-sm text-fg-muted">
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
      </div>
      <form
        className={cn('flex items-end gap-2', listOpen && 'max-sm:hidden')}
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          aria-label={labels.placeholder}
          placeholder={labels.placeholder}
          autoComplete="off"
          maxLength={2000}
          disabled={!enabled || ask.isPending}
          className="max-h-32 min-h-11 w-full min-w-0 flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2.5 text-base outline-none focus:border-primary disabled:bg-surface-muted"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
          }}
          onKeyDown={(e) => {
            // Enter sends on a keyboard; on a phone the Send button does, Enter breaks the line.
            if (e.key === 'Enter' && !e.shiftKey && !hasCoarsePointer()) {
              e.preventDefault();
              send(draft);
            }
          }}
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
      <p className="text-xs text-fg-muted">{labels.note}</p>
    </div>
  );
}
