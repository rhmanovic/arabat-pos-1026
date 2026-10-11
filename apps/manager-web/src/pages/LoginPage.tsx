import { Alert, Button, Card, CardContent, Field, Input } from '@arabat/ui';
import { ApiStatus, LanguageSwitcher } from '@arabat/web-core';
import { useTranslation } from 'react-i18next';

/**
 * Manager sign-in. The form is disabled until accounts and sessions exist (milestone M1);
 * it is not wired to a fake login.
 */
export function LoginPage() {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-primary p-10 text-primary-fg lg:flex">
        <p className="text-lg font-semibold">{t('common:appName')}</p>
        <div className="max-w-md">
          <h2 className="text-3xl font-bold">{t('title')}</h2>
          <p className="mt-3 text-primary-fg/80">{t('login.subtitle')}</p>
        </div>
        <p className="text-sm text-primary-fg/70">{t('common:interfaces.manager')}</p>
      </section>

      <section className="flex flex-col p-4 sm:p-8">
        <div className="flex items-center justify-between">
          <ApiStatus />
          <LanguageSwitcher />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <Card className="w-full max-w-sm">
            <CardContent className="flex flex-col gap-5">
              <div>
                <h1 className="text-xl font-semibold">{t('login.title')}</h1>
                <p className="mt-1 text-sm text-fg-muted lg:hidden">{t('login.subtitle')}</p>
              </div>
              <Alert tone="warning" title={t('common:auth.signInUnavailableTitle')}>
                {t('common:auth.signInUnavailableBody')}
              </Alert>
              <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
                <fieldset disabled className="flex flex-col gap-4">
                  <Field label={t('common:auth.email')}>
                    {(props) => <Input {...props} type="email" autoComplete="username" dir="ltr" />}
                  </Field>
                  <Field label={t('common:auth.password')}>
                    {(props) => (
                      <Input {...props} type="password" autoComplete="current-password" dir="ltr" />
                    )}
                  </Field>
                  <Button type="submit" block>
                    {t('common:actions.signIn')}
                  </Button>
                </fieldset>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
