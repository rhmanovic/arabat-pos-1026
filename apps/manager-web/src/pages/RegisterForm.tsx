import { emailSchema, newPasswordSchema } from '@arabat/contracts';
import { Alert, Button, Field, Input } from '@arabat/ui';
import { useApi, useCompleteSignIn, useErrorMessage } from '@arabat/web-core';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

const schema = z
  .object({
    companyName: z.string().trim().min(2).max(120),
    fullName: z.string().trim().min(2).max(120),
    email: emailSchema,
    password: newPasswordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], error: 'mismatch' });

/** Self-service merchant owner registration (creates company, main branch and owner). */
export function RegisterForm() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const complete = useCompleteSignIn('manager');
  const message = useErrorMessage();
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { companyName: '', fullName: '', email: '', password: '', confirm: '' },
  });
  const register = useMutation({
    mutationFn: (v: z.infer<typeof schema>) => {
      const language = i18n.language === 'en' ? 'en' : 'ar';
      return api.auth.register({
        company: {
          ...(language === 'ar' ? { nameAr: v.companyName } : { nameEn: v.companyName }),
          defaultLanguage: language,
        },
        owner: { fullName: v.fullName, email: v.email, password: v.password },
      });
    },
    onSuccess: async (result) => {
      if (result.status === 'authenticated') await complete(result);
    },
  });
  const e = form.formState.errors;
  const invalid = t('common:errors.VALIDATION_FAILED');

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={form.handleSubmit((v) => register.mutate(v))}
    >
      {register.error ? <Alert tone="danger" title={message(register.error)} /> : null}
      <Field label={t('register.companyName')} error={e.companyName && invalid}>
        {(p) => <Input {...p} {...form.register('companyName')} autoComplete="organization" />}
      </Field>
      <Field label={t('common:auth.fullName')} error={e.fullName && invalid}>
        {(p) => <Input {...p} {...form.register('fullName')} autoComplete="name" />}
      </Field>
      <Field label={t('common:auth.email')} error={e.email && invalid}>
        {(p) => (
          <Input {...p} {...form.register('email')} type="email" autoComplete="email" dir="ltr" />
        )}
      </Field>
      <Field
        label={t('common:auth.password')}
        hint={t('common:auth.passwordHint')}
        error={e.password && t('common:auth.passwordHint')}
      >
        {(p) => (
          <Input
            {...p}
            {...form.register('password')}
            type="password"
            autoComplete="new-password"
            dir="ltr"
          />
        )}
      </Field>
      <Field
        label={t('common:auth.confirmPassword')}
        error={e.confirm && t('common:auth.passwordsDiffer')}
      >
        {(p) => (
          <Input
            {...p}
            {...form.register('confirm')}
            type="password"
            autoComplete="new-password"
            dir="ltr"
          />
        )}
      </Field>
      <Button type="submit" block loading={register.isPending}>
        {t('register.submit')}
      </Button>
    </form>
  );
}
