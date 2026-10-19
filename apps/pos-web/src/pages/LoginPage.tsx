import {
  AcceptInvitationForm,
  AuthHeading,
  ForgotPasswordForm,
  LanguageSwitcher,
  MerchantLoginForm,
  ResetPasswordForm,
  ApiStatus,
  useApi,
  useErrorMessage,
} from '@arabat/web-core';
import { Alert, Button, Field, Input } from '@arabat/ui';
import { useMutation } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

/** Touch-first auth shell of the POS: dark full screen with one large card. */
function PosAuthShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col bg-console p-4 text-console-fg sm:p-6">
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold">{t('common:appName')}</span>
        <LanguageSwitcher />
      </div>
      <div className="flex flex-1 items-start justify-center py-6 sm:items-center sm:py-8">
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

/**
 * The page behind the e-mailed PIN link (ADR-0112, owner decision 6): the cashier chooses their
 * own device PIN; nobody else sees it. Public; the token in the link is the credential.
 */
export function PinPage() {
  const { t } = useTranslation();
  const api = useApi();
  const message = useErrorMessage();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const valid = /^\d{6,12}$/.test(pin);
  const same = pin === confirm;
  const save = useMutation({ mutationFn: () => api.auth.completePinReset({ token, pin }) });
  return (
    <PosAuthShell>
      <AuthHeading title={t('pin.title')} subtitle={t('pin.subtitle')} />
      {token.length < 20 ? (
        <Alert tone="danger" title={t('pin.missingToken')} />
      ) : save.isSuccess ? (
        <Alert tone="success" title={t('pin.done')} />
      ) : (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && same) save.mutate();
          }}
        >
          {save.isError ? <Alert tone="danger">{message(save.error)}</Alert> : null}
          <Field label={t('pin.pin')} hint={t('pin.hint')}>
            {(p) => (
              <Input
                {...p}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                maxLength={12}
                className="h-touch text-lg"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              />
            )}
          </Field>
          <Field label={t('pin.confirm')} error={confirm && !same ? t('pin.mismatch') : undefined}>
            {(p) => (
              <Input
                {...p}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                maxLength={12}
                className="h-touch text-lg"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
              />
            )}
          </Field>
          <Button type="submit" size="touch" disabled={!valid || !same} loading={save.isPending}>
            {t('pin.save')}
          </Button>
        </form>
      )}
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
