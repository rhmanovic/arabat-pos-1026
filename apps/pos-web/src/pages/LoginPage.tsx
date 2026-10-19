import {
  AcceptInvitationForm,
  AuthHeading,
  ForgotPasswordForm,
  LanguageSwitcher,
  MerchantLoginForm,
  ResetPasswordForm,
  ApiStatus,
  localizedName,
  useApi,
  useCompleteSignIn,
  useErrorMessage,
} from '@arabat/web-core';
import { ApiError } from '@arabat/api-client';
import { Alert, Button, Field, Input } from '@arabat/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

/** The branch link of the PIN sign-in (Plan A), remembered on this browser. */
const PIN_LINK_STORAGE = 'arabat.pos.pinLink';
const KEY = /^[A-Za-z0-9_-]{43}$/;
function storedPinLink(): string | null {
  try {
    const v = localStorage.getItem(PIN_LINK_STORAGE);
    return v && KEY.test(v) ? v : null;
  } catch {
    return null;
  }
}
function rememberPinLink(key: string | null) {
  try {
    if (key) localStorage.setItem(PIN_LINK_STORAGE, key);
    else localStorage.removeItem(PIN_LINK_STORAGE);
  } catch {
    // Storage blocked: the link in the address still works.
  }
}
/** `#<key>` from the manager's link wins over the remembered one. */
function linkKey(): string | null {
  const fromHash = window.location.hash.replace(/^#/, '');
  if (KEY.test(fromHash)) {
    rememberPinLink(fromHash);
    return fromHash;
  }
  return storedPinLink();
}

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
      {storedPinLink() ? (
        <Link
          to="/pin-sign-in"
          className="flex h-touch items-center justify-center rounded-md bg-primary text-lg font-medium text-primary-fg"
        >
          {t('pinSignIn.usePin')}
        </Link>
      ) : null}
      <MerchantLoginForm appInterface="pos" size="touch" />
    </PosAuthShell>
  );
}

/**
 * Sign-in with name + PIN behind the branch's link (Plan A): the branch's cashiers are listed;
 * each signs in with the PIN they chose for the tills. 3 wrong PINs lock that person 5 minutes.
 */
export function PinSignInPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const message = useErrorMessage();
  const complete = useCompleteSignIn('pos');
  const [key] = useState(linkKey);
  const [chosen, setChosen] = useState<{ membershipId: string; fullName: string } | null>(null);
  const [pin, setPin] = useState('');
  const branch = useQuery({
    queryKey: ['pos', 'pin-sign-in', key],
    queryFn: () => api.auth.pinSignInBranch(key!),
    enabled: key !== null,
    retry: false,
  });
  const signIn = useMutation({
    mutationFn: () => api.auth.pinSignIn({ key: key!, membershipId: chosen!.membershipId, pin }),
    onSuccess: async (result) => {
      if (result.status === 'authenticated') await complete(result);
    },
    onError: () => setPin(''),
  });
  const code = (e: unknown) => (e instanceof ApiError ? e.code : null);
  const invalid = code(branch.error) === 'PIN_LINK_INVALID';
  if (invalid) rememberPinLink(null);
  const signInError = (e: unknown) =>
    code(e) === 'RATE_LIMITED'
      ? t('pinSignIn.locked')
      : code(e) === 'INVALID_CREDENTIALS'
        ? t('pinSignIn.wrong')
        : message(e);
  return (
    <PosAuthShell>
      <AuthHeading
        title={
          branch.data
            ? `${localizedName(branch.data.merchant, i18n.language)} · ${
                localizedName(branch.data.branch, i18n.language) || branch.data.branch.code
              }`
            : t('pinSignIn.title')
        }
        subtitle={chosen ? chosen.fullName : t('pinSignIn.subtitle')}
      />
      {key === null || invalid ? (
        <Alert tone="warning" title={t('pinSignIn.noLink')} />
      ) : branch.isError ? (
        <Alert tone="danger">{message(branch.error)}</Alert>
      ) : !branch.data ? null : chosen ? (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{6,12}$/.test(pin)) signIn.mutate();
          }}
        >
          {signIn.isError ? <Alert tone="danger">{signInError(signIn.error)}</Alert> : null}
          <Field label={t('pin.pin')}>
            {(p) => (
              <Input
                {...p}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                dir="ltr"
                maxLength={12}
                className="h-touch text-center text-2xl tracking-widest"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              />
            )}
          </Field>
          <Button
            type="submit"
            size="touch"
            disabled={!/^\d{6,12}$/.test(pin)}
            loading={signIn.isPending}
          >
            {t('pinSignIn.signIn')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setChosen(null);
              setPin('');
              signIn.reset();
            }}
          >
            {t('pinSignIn.someoneElse')}
          </Button>
        </form>
      ) : branch.data.staff.length === 0 ? (
        <Alert tone="info" title={t('pinSignIn.nobody')} />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {branch.data.staff.map((s) => (
            <Button
              key={s.membershipId}
              variant="secondary"
              size="touch"
              disabled={!s.hasPin}
              title={s.hasPin ? undefined : t('pinSignIn.noPin')}
              onClick={() => setChosen(s)}
            >
              <bdi>{s.fullName}</bdi>
            </Button>
          ))}
        </div>
      )}
      <Link to="/login" className="text-center text-sm text-primary underline">
        {t('pinSignIn.withPassword')}
      </Link>
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
