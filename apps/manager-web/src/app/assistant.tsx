import { cn } from '@arabat/ui';
import { AssistantChat, useApi, useAssistantThread } from '@arabat/web-core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBranchContext } from './context.js';

const SUGGESTIONS = ['product', 'employee', 'payments', 'today'] as const;

/**
 * The management assistant (ADR-0105): a floating button at the bottom inline-end corner of
 * every page, opening a panel that stays above the content so the user can keep reading the
 * page they asked about. The thread lives here, in the layout, so it survives navigation.
 */
export function AssistantLauncher() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { branchId } = useBranchContext();
  const [open, setOpen] = useState(false);
  const { thread, setThread, conversationId } = useAssistantThread();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {open ? (
        <div
          ref={panelRef}
          id="manager-assistant"
          role="dialog"
          aria-label={t('assistant.title')}
          className="fixed inset-2 z-50 flex flex-col rounded-xl border border-border bg-surface p-4 shadow-xl sm:inset-auto sm:end-4 sm:bottom-20 sm:h-[min(32rem,calc(100dvh-7rem))] sm:w-[min(26rem,calc(100vw-2rem))]"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{t('assistant.title')}</h2>
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
            thread={thread}
            onThread={setThread}
            statusKey={['manager', 'assistant', 'status']}
            status={() => api.managerAssistant.status()}
            chat={(messages) =>
              api.managerAssistant.chat({
                messages,
                language: i18n.resolvedLanguage === 'en' ? 'en' : 'ar',
                branchId,
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
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? 'manager-assistant' : undefined}
        className={cn(
          'fixed end-4 bottom-4 z-50 flex h-12 items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-lg transition-colors',
          open
            ? 'bg-surface text-fg ring-1 ring-border hover:bg-surface-muted max-sm:hidden'
            : 'bg-primary text-primary-fg hover:opacity-90',
        )}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true" className="text-lg leading-none">
          ✦
        </span>
        {t('assistant.open')}
      </button>
    </>
  );
}
