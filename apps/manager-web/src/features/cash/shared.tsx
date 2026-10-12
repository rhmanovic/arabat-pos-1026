import { Badge, cn } from '@arabat/ui';
import { useTranslation } from 'react-i18next';

/** Simple in-page tabs (buttons with aria-pressed). */
export function CashTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div role="group" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-pressed={tab.key === active}
          onClick={() => onChange(tab.key)}
          className={cn(
            '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap',
            tab.key === active
              ? 'border-primary text-primary'
              : 'border-transparent text-fg-muted hover:text-fg',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

const OUTCOME_TONE = { balanced: 'success', over: 'warning', short: 'danger' } as const;

export function OutcomeBadge({ outcome }: { outcome: 'balanced' | 'over' | 'short' | null }) {
  const { t } = useTranslation();
  if (!outcome) return <Badge tone="primary">{t('cash.status_open')}</Badge>;
  return <Badge tone={OUTCOME_TONE[outcome]}>{t(`cash.outcome_${outcome}`)}</Badge>;
}
