import { Alert, Button, Field, Input } from '@arabat/ui';
import { ApiStatus, LanguageSwitcher } from '@arabat/web-core';
import { useTranslation } from 'react-i18next';

/** Operator sign-in (password + TOTP in M1). Disabled until operator accounts exist. */
export function LoginPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-console p-4">
      <div className="w-full max-w-sm rounded-lg border border-console-muted bg-console-muted p-6 text-console-fg">
        <div className="flex items-center justify-between">
          <span className="text-xs tracking-wide text-console-fg/70 uppercase">
            {t('common:appName')}
          </span>
          <LanguageSwitcher />
        </div>
        <h1 className="mt-6 text-lg font-semibold">{t('login.title')}</h1>
        <p className="mt-1 text-sm text-console-fg/70">{t('login.subtitle')}</p>
        <Alert tone="warning" className="mt-4" title={t('common:auth.signInUnavailableTitle')}>
          {t('common:auth.signInUnavailableBody')}
        </Alert>
        <form className="mt-4" onSubmit={(e) => e.preventDefault()}>
          <fieldset disabled className="flex flex-col gap-3 [&_label]:text-console-fg">
            <Field label={t('common:auth.email')}>
              {(props) => <Input {...props} type="email" dir="ltr" />}
            </Field>
            <Field label={t('common:auth.password')}>
              {(props) => <Input {...props} type="password" dir="ltr" />}
            </Field>
            <Button type="submit" block>
              {t('common:actions.signIn')}
            </Button>
          </fieldset>
        </form>
        <ApiStatus className="mt-5 text-console-fg/80" />
      </div>
    </div>
  );
}
