import { Card, CardContent } from '@arabat/ui';
import {
  ApiStatus,
  AuthHeading,
  ForgotPasswordForm,
  LanguageToggle,
  MerchantLoginForm,
} from '@arabat/web-core';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas p-4 sm:p-8">
      <div className="flex items-center justify-between">
        <ApiStatus />
        <LanguageToggle />
      </div>
      <div className="flex flex-1 items-center justify-center py-10">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col gap-5">{children}</CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Sign-in with the management account (`/auth/login` for the manager interface). */
export function LoginPage() {
  const { t } = useTranslation();
  return (
    <AuthShell>
      <AuthHeading title={t('login.title')} subtitle={t('login.subtitle')} />
      <MerchantLoginForm appInterface="manager" />
    </AuthShell>
  );
}

/** Password reset request for the same account; the e-mailed link opens the management app. */
export function ForgotPasswordPage() {
  const { t } = useTranslation('common');
  return (
    <AuthShell>
      <AuthHeading title={t('auth.forgotTitle')} />
      <ForgotPasswordForm appInterface="manager" />
    </AuthShell>
  );
}
