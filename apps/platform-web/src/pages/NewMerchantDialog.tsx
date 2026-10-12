import type { CreateMerchant } from '@arabat/contracts';
import { Alert, Button, Dialog, Field, Input, Select } from '@arabat/ui';
import { useApi, useErrorMessage, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { platformKey, useFormat } from '../shared.js';

/** Onboarding by an operator: company, plan and owner (who sets a password by e-mail). */
export function NewMerchantDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const f = useFormat();
  const notify = useNotify();
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const plans = useQuery({
    queryKey: [...platformKey, 'plans'],
    queryFn: () => api.platform.plans(),
  });
  const [v, setV] = useState({
    nameEn: '',
    nameAr: '',
    legalName: '',
    contactPhone: '',
    defaultLanguage: 'ar' as 'ar' | 'en',
    planId: '',
    ownerName: '',
    ownerEmail: '',
  });
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const create = useMutation({
    mutationFn: () => {
      const body: CreateMerchant = {
        nameEn: v.nameEn,
        nameAr: v.nameAr,
        legalName: v.legalName,
        contactPhone: v.contactPhone,
        defaultLanguage: v.defaultLanguage,
        planId: v.planId || null,
        owner: { fullName: v.ownerName, email: v.ownerEmail },
      };
      return api.platform.createMerchant(body);
    },
    onSuccess: async (m) => {
      await queryClient.invalidateQueries({ queryKey: platformKey });
      notify.ok(t('newMerchant.done'));
      onCreated(m.id);
    },
  });
  const field = (
    key: keyof typeof v,
    label: string,
    props: { dir?: 'ltr'; type?: string } = {},
  ) => (
    <Field label={label}>
      {(p) => (
        <Input {...p} {...props} value={v[key]} onChange={(e) => set({ [key]: e.target.value })} />
      )}
    </Field>
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={t('newMerchant.title')}
      size="lg"
      footer={
        <Button loading={create.isPending} onClick={() => create.mutate()}>
          {t('newMerchant.create')}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {field('nameAr', t('newMerchant.nameAr'))}
        {field('nameEn', t('newMerchant.nameEn'), { dir: 'ltr' })}
        {field('legalName', t('newMerchant.legalName'))}
        {field('contactPhone', t('newMerchant.phone'), { dir: 'ltr' })}
        <Field label={t('newMerchant.language')}>
          {(p) => (
            <Select
              {...p}
              value={v.defaultLanguage}
              onChange={(e) => set({ defaultLanguage: e.target.value as 'ar' | 'en' })}
            >
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </Select>
          )}
        </Field>
        <Field label={t('newMerchant.plan')}>
          {(p) => (
            <Select {...p} value={v.planId} onChange={(e) => set({ planId: e.target.value })}>
              <option value="">{t('newMerchant.defaultPlan')}</option>
              {plans.data?.plans
                .filter((x) => x.status === 'active')
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {f.planName(x)}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        {field('ownerName', t('newMerchant.ownerName'))}
        {field('ownerEmail', t('newMerchant.ownerEmail'), { dir: 'ltr', type: 'email' })}
        <Alert className="sm:col-span-2">{t('newMerchant.hint')}</Alert>
        {create.isError ? (
          <Alert tone="danger" className="sm:col-span-2">
            {message(create.error)}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
