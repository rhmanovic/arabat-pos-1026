import { type MerchantProfile, updateMerchantProfileSchema } from '@arabat/contracts';
import { Alert, Button, Field, Input, PageHeader, Section, Select, Spinner } from '@arabat/ui';
import { ErrorState, useApi, useNotify } from '@arabat/web-core';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { useSession } from '../../app/context.js';

type FormValues = z.input<typeof updateMerchantProfileSchema>;

function toForm(p: MerchantProfile): FormValues {
  return {
    version: p.version,
    nameAr: p.nameAr ?? '',
    nameEn: p.nameEn ?? '',
    legalName: p.legalName ?? '',
    commercialRegistrationNo: p.commercialRegistrationNo ?? '',
    contactEmail: p.contactEmail ?? '',
    contactPhone: p.contactPhone ?? '',
    defaultLanguage: p.defaultLanguage,
    timezone: p.timezone,
  };
}

/** IANA zones known to this browser; the saved one is always offered. */
function timezoneOptions(current: string): string[] {
  const known =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return known.includes(current) ? known : [current, ...known];
}

export function CompanySettingsPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const { can } = useSession();
  const editable = can('merchant.settings.update');
  const profile = useQuery({
    queryKey: ['manager', 'merchant'],
    queryFn: () => api.merchant.get(),
  });
  const form = useForm<FormValues>({ resolver: zodResolver(updateMerchantProfileSchema) });
  const watchedTimezone = useWatch({ control: form.control, name: 'timezone' });
  useEffect(() => {
    if (profile.data) form.reset(toForm(profile.data));
  }, [profile.data, form]);
  const save = useMutation({
    mutationFn: (values: FormValues) => api.merchant.update(values),
    onSuccess: async (data) => {
      queryClient.setQueryData(['manager', 'merchant'], data);
      await queryClient.invalidateQueries({ queryKey: ['auth'] });
      notify.ok(t('common.saved'));
    },
    onError: notify.fail,
  });

  if (profile.isPending) return <Spinner />;
  if (profile.isError)
    return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  const e = form.formState.errors;
  const invalid = t('common:errors.VALIDATION_FAILED');
  const chosenTimezone = watchedTimezone ?? profile.data.timezone;
  const timezoneChanging = chosenTimezone !== profile.data.timezone;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('company.title')} description={t('company.subtitle')} />
      <form
        noValidate
        onSubmit={form.handleSubmit((v) => save.mutate(v))}
        className="flex flex-col gap-6"
      >
        <Section title={t('company.title')}>
          <fieldset disabled={!editable} className="grid gap-4 md:grid-cols-2">
            <Field label={t('common.nameAr')} error={e.nameAr && invalid}>
              {(p) => <Input {...p} {...form.register('nameAr')} dir="rtl" />}
            </Field>
            <Field label={t('common.nameEn')} error={e.nameEn && invalid}>
              {(p) => <Input {...p} {...form.register('nameEn')} dir="ltr" />}
            </Field>
            <Field label={t('company.legalName')} error={e.legalName && invalid}>
              {(p) => <Input {...p} {...form.register('legalName')} />}
            </Field>
            <Field label={t('company.crNumber')} error={e.commercialRegistrationNo && invalid}>
              {(p) => <Input {...p} {...form.register('commercialRegistrationNo')} dir="ltr" />}
            </Field>
            <Field label={t('company.contactEmail')} error={e.contactEmail && invalid}>
              {(p) => <Input {...p} {...form.register('contactEmail')} type="email" dir="ltr" />}
            </Field>
            <Field label={t('company.contactPhone')} error={e.contactPhone && invalid}>
              {(p) => <Input {...p} {...form.register('contactPhone')} type="tel" dir="ltr" />}
            </Field>
            <Field label={t('company.defaultLanguage')}>
              {(p) => (
                <Select {...p} {...form.register('defaultLanguage')}>
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </Select>
              )}
            </Field>
          </fieldset>
        </Section>
        <Section title={t('company.currency')} description={t('company.fixedHint')}>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-fg-muted">{t('company.currency')}</dt>
              <dd className="font-medium">{profile.data.defaultCurrency}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t('company.status')}</dt>
              <dd className="font-medium">
                {t(`common.${profile.data.status === 'active' ? 'active' : 'inactive'}`)}
              </dd>
            </div>
          </dl>
        </Section>
        <Section title={t('company.timezone')} description={t('company.timezoneHint')}>
          <fieldset disabled={!editable} className="grid gap-4 md:grid-cols-2">
            <Field label={t('company.timezone')} error={e.timezone && invalid}>
              {(p) => (
                <Select {...p} {...form.register('timezone')} dir="ltr">
                  {timezoneOptions(profile.data.timezone).map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <p className="self-end text-sm text-fg-muted">
              {profile.data.timezoneChangedAt
                ? t('company.timezoneChangedAt', {
                    when: new Date(profile.data.timezoneChangedAt).toLocaleString(i18n.language, {
                      numberingSystem: 'latn',
                    }),
                  })
                : t('company.timezoneNeverChanged')}
            </p>
          </fieldset>
          {timezoneChanging ? (
            <Alert tone="warning" title={t('company.timezoneWarningTitle')}>
              {t('company.timezoneWarning', { from: profile.data.timezone, to: chosenTimezone })}
            </Alert>
          ) : null}
        </Section>
        {editable ? (
          <div className="flex justify-end">
            <Button type="submit" loading={save.isPending}>
              {t('common.save')}
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
