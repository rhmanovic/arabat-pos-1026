import { Alert, Button, Field, Input } from '@arabat/ui';
import { ApiStatus, LanguageSwitcher } from '@arabat/web-core';
import { useTranslation } from 'react-i18next';

/** Touch-friendly cashier sign-in; disabled until accounts exist (milestone M1). */
export function LoginPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col bg-console p-4 text-console-fg sm:p-6">
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold">{t('common:appName')}</span>
        <LanguageSwitcher />
      </div>
      <div className="flex flex-1 items-center justify-center py-8">
        <div className="w-full max-w-md rounded-xl bg-surface p-6 text-fg shadow-lg sm:p-8">
          <h1 className="text-2xl font-bold">{t('login.title')}</h1>
          <p className="mt-1 text-fg-muted">{t('login.subtitle')}</p>
          <Alert tone="warning" className="mt-5" title={t('common:auth.signInUnavailableTitle')}>
            {t('common:auth.signInUnavailableBody')}
          </Alert>
          <form className="mt-6" onSubmit={(e) => e.preventDefault()}>
            <fieldset disabled className="flex flex-col gap-4">
              <Field label={t('common:auth.email')}>
                {(props) => <Input {...props} type="email" className="h-touch text-lg" dir="ltr" />}
              </Field>
              <Field label={t('common:auth.password')}>
                {(props) => (
                  <Input {...props} type="password" className="h-touch text-lg" dir="ltr" />
                )}
              </Field>
              <Button type="submit" size="touch" block>
                {t('common:actions.signIn')}
              </Button>
            </fieldset>
          </form>
          <ApiStatus className="mt-6" />
        </div>
      </div>
    </div>
  );
}
