import {
  AcceptInvitationForm,
  AuthHeading,
  ForgotPasswordForm,
  LanguageSwitcher,
  MerchantLoginForm,
  ResetPasswordForm,
  ApiStatus,
} from '@arabat/web-core';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Touch-first auth shell of the POS: dark full screen with one large card. */
function PosAuthShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col bg-console p-4 text-console-fg sm:p-6">
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold">{t('common:appName')}</span>
        <LanguageSwitcher />
      </div>
      <div className="flex flex-1 items-center justify-center py-8">
        <div className="flex w-full max-w-md flex-col gap-5 rounded-xl bg-surface p-6 text-fg shadow-lg sm:p-8">
          {children}
          <ApiStatus />
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  return (
    <PosAuthShell>
      <AuthHeading title={t('login.title')} subtitle={t('login.subtitle')} />
      <MerchantLoginForm appInterface="pos" size="touch" />
    </PosAuthShell>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation('common');
  return (
    <PosAuthShell>
      <AuthHeading title={t('auth.forgotTitle')} />
      <ForgotPasswordForm appInterface="pos" size="touch" />
    </PosAuthShell>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation('common');
  return (
    <PosAuthShell>
      <AuthHeading title={t('auth.resetTitle')} />
      <ResetPasswordForm size="touch" />
    </PosAuthShell>
  );
}

export function AcceptInvitePage() {
  const { t } = useTranslation('common');
  return (
    <PosAuthShell>
      <AuthHeading title={t('invite.title')} />
      <AcceptInvitationForm size="touch" />
    </PosAuthShell>
  );
}
