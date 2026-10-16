import type {
  AssistantConversation,
  AssistantConversationList,
  AssistantMessage,
  AssistantReply,
  AssistantStatus,
} from '@arabat/contracts';
import { cn } from '@arabat/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AssistantChat, type AssistantLabels, useAssistantThread } from './assistant.js';

/** What an app binds the launcher to: its endpoints and the context it sends with a question. */
export interface AssistantBindings {
  /** Query key of the status probe (one per app surface). */
  statusKey: readonly string[];
  status: () => Promise<AssistantStatus>;
  chat: (messages: AssistantMessage[], conversationId: string) => Promise<AssistantReply>;
  conversations: () => Promise<AssistantConversationList>;
  conversation: (id: string) => Promise<AssistantConversation>;
}

/**
 * The assistant as every app shows it (ADR-0105): one floating button at the bottom inline-end
 * corner of the layout, a chat panel above the content (full screen on phones), the user's
 * conversations down the side. Mounted in the layout so it is on every page and the active
 * conversation survives navigation. An app passes only its bindings and strings.
 */
export function AssistantLauncher({
  id,
  bindings,
  labels,
  suggestions,
  hotkey,
}: {
  /** DOM id of the panel (one launcher per app). */
  id: string;
  bindings: AssistantBindings;
  labels: AssistantLabels & { open: string };
  suggestions: string[];
  /** Keyboard shortcut that opens the panel (e.g. "F9" on the register). */
  hotkey?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const state = useAssistantThread();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open && e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      } else if (!open && hotkey && e.key === hotkey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, hotkey]);

  return (
    <>
      {open ? (
        <div
          id={id}
          role="dialog"
          aria-label={labels.title}
          className="fixed inset-2 z-50 flex flex-col rounded-xl border border-border bg-surface p-4 shadow-xl sm:inset-auto sm:end-4 sm:bottom-20 sm:h-[min(40rem,calc(100dvh-7rem))] sm:w-[min(46rem,calc(100vw-2rem))]"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{labels.title}</h2>
            <button
              type="button"
              aria-label={t('common:actions.close')}
              className="grid size-9 place-items-center rounded-md text-lg text-fg-muted hover:bg-surface-muted"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>
          <AssistantChat
            state={state}
            statusKey={bindings.statusKey}
            status={bindings.status}
            conversations={bindings.conversations}
            conversation={bindings.conversation}
            chat={(messages) => bindings.chat(messages, state.conversationId)}
            labels={labels}
            suggestions={suggestions}
          />
        </div>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={cn(
          'fixed end-4 bottom-4 z-50 flex h-12 items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-lg transition-colors',
          open
            ? 'bg-surface text-fg ring-1 ring-border hover:bg-surface-muted max-sm:hidden'
            : 'bg-primary text-primary-fg hover:opacity-90',
        )}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true" className="text-lg leading-none">
          ✦
        </span>
        {labels.open}
      </button>
    </>
  );
}

/** The chat strings of an app's `assistant` namespace, as the launcher needs them. */
export function assistantLabels(t: (key: string) => string): AssistantLabels & { open: string } {
  return {
    open: t('assistant.open'),
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
  };
}
