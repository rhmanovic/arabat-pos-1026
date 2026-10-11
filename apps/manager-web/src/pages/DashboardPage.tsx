import { EmptyState } from '@arabat/ui';
import { useTranslation } from 'react-i18next';

export function DashboardPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('dashboard.title')}</h1>
      <EmptyState title={t('dashboard.emptyTitle')} description={t('dashboard.emptyBody')} />
    </div>
  );
}
