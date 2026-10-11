import { Card, CardContent } from '@arabat/ui';
import {
  ApiStatus,
  AuthHeading,
  ForgotPasswordForm,
  LanguageSwitcher,
  MerchantLoginForm,
  ResetPasswordForm,
} from '@arabat/web-core';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { RegisterForm } from './RegisterForm.js';

/** Two-column auth shell of the management app (brand panel + form card). */
export function ManagerAuthShell({ children }: { children: ReactNode }) {
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
          <Card className="w-full max-w-md">
            <CardContent className="flex flex-col gap-5">{children}</CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  return (
    <ManagerAuthShell>
      <AuthHeading title={t('login.title')} />
      <MerchantLoginForm appInterface="manager" />
      <p className="border-t border-border pt-4 text-center text-sm text-fg-muted">
        {t('common:auth.noAccount')}{' '}
        <Link to="/register" className="font-medium text-primary hover:underline">
          {t('common:auth.createAccount')}
        </Link>
      </p>
    </ManagerAuthShell>
  );
}

export function RegisterPage() {
  const { t } = useTranslation();
  return (
    <ManagerAuthShell>
      <AuthHeading title={t('register.title')} subtitle={t('register.subtitle')} />
      <RegisterForm />
      <p className="border-t border-border pt-4 text-center text-sm text-fg-muted">
        {t('common:auth.haveAccount')}{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">
          {t('common:actions.signIn')}
        </Link>
      </p>
    </ManagerAuthShell>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation('common');
  return (
    <ManagerAuthShell>
      <AuthHeading title={t('auth.forgotTitle')} />
      <ForgotPasswordForm appInterface="manager" />
    </ManagerAuthShell>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation('common');
  return (
    <ManagerAuthShell>
      <AuthHeading title={t('auth.resetTitle')} />
      <ResetPasswordForm />
    </ManagerAuthShell>
  );
}
