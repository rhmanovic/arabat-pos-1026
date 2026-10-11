import { emailSchema } from '@arabat/contracts';
import { Alert, Button, Field, Input } from '@arabat/ui';
import {
  ApiStatus,
  LanguageSwitcher,
  useApi,
  useCompleteSignIn,
  useErrorMessage,
} from '@arabat/web-core';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

const credentialsSchema = z.object({ email: emailSchema, password: z.string().min(1) });
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

/** Operator sign-in: password, then a mandatory TOTP code. */
export function LoginPage() {
  const { t } = useTranslation();
  const api = useApi();
  const message = useErrorMessage();
  const complete = useCompleteSignIn('platform');
  const [ticket, setTicket] = useState<string | null>(null);

  const credentials = useForm({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: '', password: '' },
  });
  const codeForm = useForm({ resolver: zodResolver(codeSchema), defaultValues: { code: '' } });
  const login = useMutation({
    mutationFn: (v: z.infer<typeof credentialsSchema>) => api.auth.platformLogin(v),
    onSuccess: (result) => {
      if (result.status === 'mfa_required') setTicket(result.ticket);
    },
  });
  const verify = useMutation({
    mutationFn: (v: z.infer<typeof codeSchema>) =>
      api.auth.platformMfa({ ticket: ticket!, code: v.code }),
    onSuccess: async (result) => {
      if (result.status === 'authenticated') await complete(result);
    },
    onError: () => codeForm.reset(),
  });
  const error = login.error ?? verify.error;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-console p-4">
      <div className="w-full max-w-sm rounded-lg border border-console-muted bg-console-muted p-6 text-console-fg">
        <div className="flex items-center justify-between">
          <span className="text-xs tracking-wide text-console-fg/70 uppercase">
            {t('common:appName')}
          </span>
          <LanguageSwitcher />
        </div>
        <h1 className="mt-6 text-lg font-semibold">
          {ticket ? t('common:auth.mfaTitle') : t('login.title')}
        </h1>
        <p className="mt-1 text-sm text-console-fg/70">
          {ticket ? t('common:auth.mfaBody') : t('login.subtitle')}
        </p>
        {error ? <Alert tone="danger" className="mt-4" title={message(error)} /> : null}
        {ticket ? (
          <form
            key="mfa"
            className="mt-4 flex flex-col gap-3 [&_label]:text-console-fg"
            noValidate
            onSubmit={codeForm.handleSubmit((v) => verify.mutate(v))}
          >
            <Field label={t('common:auth.mfaCode')}>
              {(p) => (
                <Input
                  {...p}
                  {...codeForm.register('code')}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  dir="ltr"
                  autoFocus
                />
              )}
            </Field>
            <Button type="submit" block loading={verify.isPending}>
              {t('common:auth.verify')}
            </Button>
            <Button variant="ghost" className="text-console-fg" onClick={() => setTicket(null)}>
              {t('common:auth.backToSignIn')}
            </Button>
          </form>
        ) : (
          <form
            key="password"
            className="mt-4 flex flex-col gap-3 [&_label]:text-console-fg"
            noValidate
            onSubmit={credentials.handleSubmit((v) => login.mutate(v))}
          >
            <Field label={t('common:auth.email')}>
              {(p) => (
                <Input
                  {...p}
                  {...credentials.register('email')}
                  type="email"
                  autoComplete="username"
                  dir="ltr"
                />
              )}
            </Field>
            <Field label={t('common:auth.password')}>
              {(p) => (
                <Input
                  {...p}
                  {...credentials.register('password')}
                  type="password"
                  autoComplete="current-password"
                  dir="ltr"
                />
              )}
            </Field>
            <Button type="submit" block loading={login.isPending}>
              {t('common:actions.signIn')}
            </Button>
          </form>
        )}
        <ApiStatus className="mt-5 text-console-fg/80" />
      </div>
    </div>
  );
}
