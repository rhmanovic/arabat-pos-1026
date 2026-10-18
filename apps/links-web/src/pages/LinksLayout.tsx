import { Alert, Button } from '@arabat/ui';
import { LanguageToggle, localizedName, useAuth, useLogout } from '@arabat/web-core';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';

/** The management app's address: same origin in production, its own port in development. */
export function managerUrl(): string {
  return import.meta.env.DEV ? 'http://localhost:5173/manager/' : '/manager/';
}

/** Shell of the link-page app: its own header, no management navigation (ADR-0116 am. 1). */
export function LinksLayout() {
  const { t, i18n } = useTranslation();
  const { state, hasPermission } = useAuth();
  const logout = useLogout('manager');
  const session = state.status === 'authenticated' ? state.session : null;
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <span className="grid size-8 place-items-center rounded-md bg-primary text-sm font-bold text-primary-fg">
            ع
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-sm font-semibold">{t('title')}</p>
            {session?.merchant ? (
              <p className="truncate text-xs text-fg-muted" data-testid="merchant-name">
                {localizedName(session.merchant, i18n.language)}
              </p>
            ) : null}
          </div>
          <a
            href={managerUrl()}
            className="hidden text-sm text-fg-muted hover:text-fg hover:underline sm:inline"
          >
            {t('backToManager')}
          </a>
          <LanguageToggle />
          <Button
            variant="ghost"
            size="sm"
            loading={logout.isPending}
            onClick={() => logout.mutate()}
          >
            {t('common:actions.signOut')}
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl p-4 pb-20 sm:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="mt-1 text-fg-muted">{t('subtitle')}</p>
        </div>
        {hasPermission('online.manage') ? (
          <Outlet />
        ) : (
          <Alert tone="warning">{t('noAccess')}</Alert>
        )}
      </main>
    </div>
  );
}
