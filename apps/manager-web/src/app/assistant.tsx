import { AssistantLauncher, assistantLabels, useApi } from '@arabat/web-core';
import { useTranslation } from 'react-i18next';
import { useBranchContext } from './context.js';

const SUGGESTIONS = ['product', 'employee', 'payments', 'today'] as const;

/** The management assistant (ADR-0107): the shared launcher bound to the manager endpoints. */
export function ManagerAssistant() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { branchId } = useBranchContext();
  return (
    <AssistantLauncher
      id="manager-assistant"
      bindings={{
        statusKey: ['manager', 'assistant', 'status'],
        status: () => api.managerAssistant.status(),
        conversations: () => api.managerAssistant.conversations(),
        conversation: (id) => api.managerAssistant.conversation(id),
        chat: (messages, conversationId) =>
          api.managerAssistant.chat({
            messages,
            language: i18n.resolvedLanguage === 'en' ? 'en' : 'ar',
            branchId,
            conversationId,
          }),
      }}
      labels={assistantLabels(t)}
      suggestions={SUGGESTIONS.map((s) => t(`assistant.suggestions.${s}`))}
    />
  );
}
