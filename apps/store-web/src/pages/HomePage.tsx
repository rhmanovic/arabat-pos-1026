import { EmptyState } from '@arabat/ui';
import { LanguageSwitcher } from '@arabat/web-core';
import { useTranslation } from 'react-i18next';

export function HomePage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 p-6">
      <LanguageSwitcher />
      <EmptyState title={t('home.title')} description={t('home.description')} />
    </main>
  );
}
