import { ApiError } from '@arabat/api-client';
import { Spinner } from '@arabat/ui';
import { ErrorState, LanguageSwitcher, LinkPageView, NotFound, useApi } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

/** Public link page ("link in bio", ADR-0116) at /store/links/:slug. */
export function LinksPage() {
  const slug = useParams()['slug'] ?? '';
  const api = useApi();
  const { t, i18n } = useTranslation();
  const page = useQuery({
    queryKey: ['links', slug],
    queryFn: () => api.linkPage.public(slug),
  });
  const ar = i18n.language.startsWith('ar');
  const title = page.data
    ? ((ar ? page.data.titleAr || page.data.titleEn : page.data.titleEn || page.data.titleAr) ?? '')
    : '';
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  if (page.isPending)
    return (
      <div className="flex min-h-dvh items-center justify-center text-primary">
        <Spinner size="lg" label={t('common:status.loading')} />
      </div>
    );
  if (page.isError)
    return page.error instanceof ApiError && page.error.status === 404 ? (
      <NotFound />
    ) : (
      <ErrorState error={page.error} onRetry={() => void page.refetch()} fullPage />
    );

  const data = page.data;
  const open = (itemId: string) => {
    // Counting is best effort: the visitor always reaches the link (BR-201).
    try {
      navigator.sendBeacon?.(api.linkPage.clickUrl(data.slug, itemId));
    } catch {
      /* ignored */
    }
  };
  return (
    <LinkPageView
      className="min-h-dvh"
      page={data}
      language={i18n.language}
      emptyLabel={t('links.empty')}
      onOpen={open}
      toolbar={<LanguageSwitcher />}
    />
  );
}
