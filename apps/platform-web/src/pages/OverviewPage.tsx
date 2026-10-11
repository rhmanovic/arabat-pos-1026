import { EmptyState } from '@arabat/ui';
import { useTranslation } from 'react-i18next';

export function OverviewPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('overview.title')}</h1>
      <EmptyState title={t('overview.emptyTitle')} description={t('overview.emptyBody')} />
    </div>
  );
}
