import { EmptyState } from '@arabat/ui';
import { useTranslation } from 'react-i18next';

/** Register screen skeleton: catalog area + cart panel on the end side. Selling arrives in M4. */
export function RegisterPage() {
  const { t } = useTranslation();
  return (
    <div className="grid h-full grid-rows-[1fr_auto] gap-3 p-3 md:grid-cols-[1fr_24rem] md:grid-rows-1">
      <section
        aria-labelledby="catalog-title"
        className="flex min-h-0 flex-col rounded-lg bg-surface p-4"
      >
        <h1 id="catalog-title" className="text-lg font-semibold">
          {t('register.catalogTitle')}
        </h1>
        <EmptyState
          className="mt-4 flex-1"
          title={t('register.catalogTitle')}
          description={t('register.catalogEmpty')}
        />
      </section>
      <aside aria-labelledby="cart-title" className="flex flex-col rounded-lg bg-surface p-4">
        <h2 id="cart-title" className="text-lg font-semibold">
          {t('register.cartTitle')}
        </h2>
        <p className="mt-4 text-fg-muted">{t('register.cartEmpty')}</p>
      </aside>
    </div>
  );
}
