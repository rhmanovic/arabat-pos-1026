import { ApiError } from '@arabat/api-client';
import {
  type BranchOption,
  type LoginResult,
  type MerchantInterface,
  type MerchantOption,
  PASSWORD_MIN_LENGTH,
  emailSchema,
  newPasswordSchema,
} from '@arabat/contracts';
import { Alert, Button, Field, Input, cn } from '@arabat/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { useApi } from './api-context.js';
import { authQueryKey } from './auth.js';
import { useErrorMessage } from './components.js';

type Size = 'default' | 'touch';

const APP_PATHS: Record<MerchantInterface, string> = { manager: '/manager/', pos: '/pos/' };

/** Display name in the active language, falling back to the other one. */
export function localizedName(
  item: { nameAr: string | null; nameEn: string | null },
  language: string,
): string {
  return (
    (language.startsWith('ar') ? (item.nameAr ?? item.nameEn) : (item.nameEn ?? item.nameAr)) ?? ''
  );
}

/**
 * After a successful sign-in in this app: refresh the session and go back to where the user
 * wanted to go. A session for another app (interface switch) navigates to that app.
 */
export function useCompleteSignIn(appInterface: MerchantInterface | 'platform') {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  return async (result: Extract<LoginResult, { status: 'authenticated' }>) => {
    if (result.interface !== appInterface) {
      window.location.assign(result.redirectTo);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: authQueryKey(appInterface) });
    const from = (location.state as { from?: string } | null)?.from;
    await navigate(from && !from.startsWith('/login') ? from : '/', { replace: true });
  };
}

function FormError({ error }: { error: unknown }) {
  const { t } = useTranslation('common');
  const message = useErrorMessage()(error);
  if (!error) return null;
  if (error instanceof ApiError && error.code === 'INTERFACE_NOT_PERMITTED') {
    const apps = error.problem.availableInterfaces ?? [];
    return (
      <Alert tone="warning" title={t('auth.useOtherApp')}>
        <div className="mt-2 flex flex-wrap gap-2">
          {apps.map((app) => (
            <a key={app} href={APP_PATHS[app]} className="font-medium text-primary underline">
              {t('auth.openApp', { app: t(`interfaces.${app}`) })}
            </a>
          ))}
        </div>
      </Alert>
    );
  }
  return <Alert tone="danger" title={message} />;
}

const loginFormSchema = z.object({ email: emailSchema, password: z.string().min(1) });

/** E-mail + password sign-in for /manager or /pos, including merchant/branch selection. */
export function MerchantLoginForm({
  appInterface,
  size = 'default',
}: {
  appInterface: MerchantInterface;
  size?: Size;
}) {
  const { t } = useTranslation('common');
  const api = useApi();
  const complete = useCompleteSignIn(appInterface);
  const [selection, setSelection] = useState<Extract<
    LoginResult,
    { status: 'select_merchant' }
  > | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: '', password: '' },
  });
  const login = useMutation({
    mutationFn: (values: z.infer<typeof loginFormSchema>) =>
      api.auth.login({ interface: appInterface, ...values }),
    onSuccess: async (result) => {
      if (result.status === 'authenticated') await complete(result);
      else if (result.status === 'select_merchant') setSelection(result);
    },
  });

  if (selection) {
    return (
      <MerchantPicker
        appInterface={appInterface}
        merchants={selection.merchants}
        size={size}
        onBack={() => setSelection(null)}
        onPick={(merchantId, branchId) =>
          api.auth.selectMerchant({
            ticket: selection.ticket,
            merchantId,
            ...(branchId ? { branchId } : {}),
          })
        }
        onDone={complete}
      />
    );
  }

  const inputClass = size === 'touch' ? 'h-touch text-lg' : undefined;
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={form.handleSubmit((v) => login.mutate(v))}
    >
      <FormError error={login.error} />
      <Field
        label={t('auth.email')}
        error={form.formState.errors.email && t('errors.VALIDATION_FAILED')}
      >
        {(p) => (
          <Input
            {...p}
            {...form.register('email')}
            type="email"
            autoComplete="username"
            dir="ltr"
            className={inputClass}
          />
        )}
      </Field>
      <Field
        label={t('auth.password')}
        error={form.formState.errors.password && t('errors.VALIDATION_FAILED')}
      >
        {(p) => (
          <div className="relative">
            <Input
              {...p}
              {...form.register('password')}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              dir="ltr"
              className={cn(inputClass, 'pe-20')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              className="absolute inset-y-0 end-0 min-w-11 px-3 text-sm font-medium text-primary"
            >
              {showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
            </button>
          </div>
        )}
      </Field>
      <Button
        type="submit"
        size={size === 'touch' ? 'touch' : 'md'}
        block
        loading={login.isPending}
      >
        {t('actions.signIn')}
      </Button>
      <Link to="/forgot-password" className="text-center text-sm text-primary hover:underline">
        {t('auth.forgotPassword')}
      </Link>
    </form>
  );
}

/** Merchant (and, for the POS, branch) choice after a correct password. */
export function MerchantPicker({
  appInterface,
  merchants,
  size = 'default',
  onPick,
  onDone,
  onBack,
}: {
  appInterface: MerchantInterface;
  merchants: MerchantOption[];
  size?: Size;
  onPick: (merchantId: string, branchId?: string) => Promise<LoginResult>;
  onDone: (result: Extract<LoginResult, { status: 'authenticated' }>) => Promise<void>;
  onBack?: () => void;
}) {
  const { t, i18n } = useTranslation('common');
  const [merchantId, setMerchantId] = useState(merchants.length === 1 ? merchants[0]!.id : '');
  const pick = useMutation({
    mutationFn: (branchId?: string) => onPick(merchantId, branchId),
    onSuccess: async (result) => {
      if (result.status === 'authenticated') await onDone(result);
    },
  });
  const merchant = merchants.find((m) => m.id === merchantId);
  const needsBranch = appInterface === 'pos' && merchant && merchant.branches.length > 1;

  return (
    <div className="flex flex-col gap-4">
      <FormError error={pick.error} />
      {appInterface === 'manager' || !merchant || merchants.length > 1 ? (
        <OptionList
          title={t('auth.chooseMerchant')}
          size={size}
          options={merchants.map((m) => ({ id: m.id, label: localizedName(m, i18n.language) }))}
          selected={merchantId}
          onSelect={(id) => {
            setMerchantId(id);
            const chosen = merchants.find((m) => m.id === id)!;
            if (appInterface === 'manager' || chosen.branches.length === 1)
              pick.mutate(chosen.branches[0]?.id);
          }}
        />
      ) : null}
      {needsBranch ? (
        <BranchList
          branches={merchant.branches}
          size={size}
          onSelect={(branchId) => pick.mutate(branchId)}
        />
      ) : null}
      {onBack ? (
        <Button variant="ghost" onClick={onBack}>
          {t('auth.backToSignIn')}
        </Button>
      ) : null}
    </div>
  );
}

export function BranchList({
  branches,
  size = 'default',
  onSelect,
}: {
  branches: BranchOption[];
  size?: Size;
  onSelect: (id: string) => void;
}) {
  const { t, i18n } = useTranslation('common');
  return (
    <OptionList
      title={t('auth.chooseBranch')}
      size={size}
      options={branches.map((b) => ({ id: b.id, label: localizedName(b, i18n.language) }))}
      onSelect={onSelect}
    />
  );
}

function OptionList({
  title,
  options,
  selected,
  onSelect,
  size,
}: {
  title: string;
  options: { id: string; label: string }[];
  selected?: string;
  onSelect: (id: string) => void;
  size: Size;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-semibold">{title}</legend>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onSelect(o.id)}
          aria-pressed={selected === o.id}
          className={cn(
            'rounded-md border border-border bg-surface px-4 text-start font-medium hover:border-primary hover:bg-primary-soft',
            size === 'touch' ? 'min-h-touch text-lg' : 'py-3',
            selected === o.id && 'border-primary bg-primary-soft',
          )}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}

/** Password recovery request. The answer is the same whether or not the account exists. */
export function ForgotPasswordForm({
  appInterface,
  size = 'default',
}: {
  appInterface: MerchantInterface;
  size?: Size;
}) {
  const { t } = useTranslation('common');
  const api = useApi();
  const form = useForm({
    resolver: zodResolver(z.object({ email: emailSchema })),
    defaultValues: { email: '' },
  });
  const request = useMutation({
    mutationFn: (values: { email: string }) =>
      api.auth.forgotPassword({ email: values.email, interface: appInterface }),
  });
  if (request.isSuccess) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" title={t('auth.forgotSent')} />
        <BackToSignIn />
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={form.handleSubmit((v) => request.mutate(v))}
    >
      <p className="text-sm text-fg-muted">{t('auth.forgotBody')}</p>
      <FormError error={request.error} />
      <Field
        label={t('auth.email')}
        error={form.formState.errors.email && t('errors.VALIDATION_FAILED')}
      >
        {(p) => (
          <Input
            {...p}
            {...form.register('email')}
            type="email"
            dir="ltr"
            className={size === 'touch' ? 'h-touch text-lg' : undefined}
          />
        )}
      </Field>
      <Button
        type="submit"
        size={size === 'touch' ? 'touch' : 'md'}
        block
        loading={request.isPending}
      >
        {t('auth.forgotSend')}
      </Button>
      <BackToSignIn />
    </form>
  );
}

/** New password from the e-mailed link (?token=...). */
export function ResetPasswordForm({ size = 'default' }: { size?: Size }) {
  const { t } = useTranslation('common');
  const api = useApi();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const schema = z
    .object({ password: newPasswordSchema, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { path: ['confirm'], error: 'mismatch' });
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });
  const reset = useMutation({
    mutationFn: (password: string) => api.auth.resetPassword({ token, password }),
  });

  if (token.length < 20) return <Alert tone="danger" title={t('auth.resetMissingToken')} />;
  if (reset.isSuccess) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" title={t('auth.resetDone')} />
        <BackToSignIn />
      </div>
    );
  }
  const errors = form.formState.errors;
  const inputClass = size === 'touch' ? 'h-touch text-lg' : undefined;
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={form.handleSubmit((v) => reset.mutate(v.password))}
    >
      <FormError error={reset.error} />
      <Field
        label={t('auth.newPassword')}
        hint={t('auth.passwordHint')}
        error={errors.password && t('auth.passwordHint')}
      >
        {(p) => (
          <Input
            {...p}
            {...form.register('password')}
            type="password"
            autoComplete="new-password"
            dir="ltr"
            minLength={PASSWORD_MIN_LENGTH}
            className={inputClass}
          />
        )}
      </Field>
      <Field label={t('auth.confirmPassword')} error={errors.confirm && t('auth.passwordsDiffer')}>
        {(p) => (
          <Input
            {...p}
            {...form.register('confirm')}
            type="password"
            autoComplete="new-password"
            dir="ltr"
            className={inputClass}
          />
        )}
      </Field>
      <Button
        type="submit"
        size={size === 'touch' ? 'touch' : 'md'}
        block
        loading={reset.isPending}
      >
        {t('auth.resetSubmit')}
      </Button>
    </form>
  );
}

export function BackToSignIn() {
  const { t } = useTranslation('common');
  return (
    <Link to="/login" className="text-center text-sm text-primary hover:underline">
      {t('auth.backToSignIn')}
    </Link>
  );
}

/** Consistent heading block used by the auth pages of every app. */
export function AuthHeading({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div>
      <h1 className="text-xl font-semibold">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-fg-muted">{subtitle}</p> : null}
    </div>
  );
}

/** Signs out of the current interface and returns to its sign-in page. */
export function useLogout(appInterface: MerchantInterface | 'platform') {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api.auth.logout(appInterface),
    onSettled: async () => {
      // Mark the session anonymous first so guards never see the old session again,
      // then drop every other cached server state of the signed-out user.
      queryClient.setQueryData(authQueryKey(appInterface), null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
      await navigate('/login', { replace: true });
    },
  });
}

/** Opens the other merchant app (manager ↔ POS) through a server-checked switch. */
export function useSwitchInterface(from: MerchantInterface) {
  const api = useApi();
  return useMutation({
    mutationFn: (vars: { target: MerchantInterface; branchId?: string }) =>
      api.auth.switchInterface(from, vars),
    onSuccess: (result) => {
      if (result.status === 'authenticated') window.location.assign(result.redirectTo);
    },
  });
}

/** Employee onboarding from an invitation link (?token=...): choose or confirm the password. */
export function AcceptInvitationForm({ size = 'default' }: { size?: Size }) {
  const { t, i18n } = useTranslation('common');
  const api = useApi();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.auth.previewInvitation(token),
    enabled: token.length >= 20,
    retry: false,
  });
  const existing = preview.data?.existingAccount ?? false;
  const schema = existing
    ? z.object({ password: z.string().min(1), confirm: z.string() })
    : z
        .object({ password: newPasswordSchema, confirm: z.string() })
        .refine((v) => v.password === v.confirm, { path: ['confirm'], error: 'mismatch' });
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });
  const accept = useMutation({
    mutationFn: (password: string) =>
      api.auth.acceptInvitation({
        token,
        password,
        preferredLanguage: i18n.language === 'en' ? 'en' : 'ar',
      }),
  });
  const message = useErrorMessage();

  if (token.length < 20) return <Alert tone="danger" title={t('invite.invalid')} />;
  if (preview.isPending) return <p className="text-sm text-fg-muted">{t('status.loading')}</p>;
  if (preview.isError) return <Alert tone="danger" title={message(preview.error)} />;
  if (accept.isSuccess) {
    const apps = accept.data.availableInterfaces;
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" title={t('invite.done')} />
        {apps.map((app) => (
          <a
            key={app}
            href={`${APP_PATHS[app]}login`}
            className="text-center font-medium text-primary underline"
          >
            {t('auth.openApp', { app: t(`interfaces.${app}`) })}
          </a>
        ))}
      </div>
    );
  }
  const company = localizedName(preview.data.merchant, i18n.language);
  const inputClass = size === 'touch' ? 'h-touch text-lg' : undefined;
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={form.handleSubmit((v) => accept.mutate(v.password))}
    >
      <p className="text-sm text-fg-muted">
        {t('invite.intro', { name: preview.data.fullName, company })}{' '}
        <span dir="ltr">{preview.data.email}</span>
      </p>
      {existing ? <Alert tone="info" title={t('invite.existing')} /> : null}
      {accept.error ? <FormError error={accept.error} /> : null}
      <Field
        label={existing ? t('auth.password') : t('auth.newPassword')}
        hint={existing ? undefined : t('auth.passwordHint')}
        error={
          form.formState.errors.password &&
          (existing ? t('errors.VALIDATION_FAILED') : t('auth.passwordHint'))
        }
      >
        {(p) => (
          <Input
            {...p}
            {...form.register('password')}
            type="password"
            autoComplete={existing ? 'current-password' : 'new-password'}
            dir="ltr"
            className={inputClass}
          />
        )}
      </Field>
      {existing ? null : (
        <Field
          label={t('auth.confirmPassword')}
          error={form.formState.errors.confirm && t('auth.passwordsDiffer')}
        >
          {(p) => (
            <Input
              {...p}
              {...form.register('confirm')}
              type="password"
              autoComplete="new-password"
              dir="ltr"
              className={inputClass}
            />
          )}
        </Field>
      )}
      <Button
        type="submit"
        size={size === 'touch' ? 'touch' : 'md'}
        block
        loading={accept.isPending}
      >
        {t('invite.submit')}
      </Button>
    </form>
  );
}
