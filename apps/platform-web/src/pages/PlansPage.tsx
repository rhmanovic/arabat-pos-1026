import type { Plan, SavePlan } from '@arabat/contracts';
import { PLAN_FEATURES, PLAN_LIMITS } from '@arabat/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
} from '@arabat/ui';
import { useApi, useErrorMessage, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { platformKey, useFormat, useRole } from '../shared.js';

export function PlansPage() {
  const { t } = useTranslation();
  const api = useApi();
  const f = useFormat();
  const { can } = useRole();
  const editable = can('platform.super_admin', 'platform.billing');
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const plans = useQuery({
    queryKey: [...platformKey, 'plans'],
    queryFn: () => api.platform.plans(),
  });
  const limit = (v: number | null) => (v === null ? '∞' : String(v));
  return (
    <div>
      <PageHeader
        title={t('plans.title')}
        description={t('plans.subtitle')}
        actions={
          editable ? <Button onClick={() => setEditing('new')}>{t('plans.new')}</Button> : null
        }
      />
      <DataTable
        caption={t('plans.title')}
        loading={plans.isPending}
        rows={plans.data?.plans}
        rowKey={(p) => p.id}
        {...(editable ? { onRowClick: (p: Plan) => setEditing(p) } : {})}
        columns={[
          {
            key: 'name',
            header: t('plans.name'),
            cell: (p) => (
              <span className="flex flex-wrap items-center gap-1">
                <span className="font-medium">{f.planName(p)}</span>
                <span dir="ltr" className="text-xs text-fg-muted">
                  {p.code}
                </span>
                {p.isDefault ? <Badge tone="primary">{t('plans.default')}</Badge> : null}
                {p.status === 'archived' ? <Badge>{t('plans.archived')}</Badge> : null}
                {!p.isPublic ? <Badge>{t('plans.hidden')}</Badge> : null}
              </span>
            ),
          },
          {
            key: 'limits',
            header: t('plans.limits'),
            cell: (p) => (
              <span className="text-xs tabular-nums">
                {PLAN_LIMITS.map(
                  (k) => `${t(`detail.limit_${k}`).split(' (')[0]}: ${limit(p.limits[k])}`,
                ).join(' · ')}
              </span>
            ),
          },
          {
            key: 'features',
            header: t('plans.features'),
            hideBelow: 'md',
            cell: (p) => p.features.map((x) => t(`detail.feature_${x}`)).join('، ') || '—',
          },
          {
            key: 'price',
            header: t('plans.price'),
            hideBelow: 'md',
            cell: (p) =>
              p.price ? (
                <span dir="ltr">
                  {t(p.billingPeriod === 'year' ? 'plans.perYear' : 'plans.perMonth', {
                    price: `${p.price.amount} ${p.price.currency}`,
                  })}
                </span>
              ) : (
                t('plans.noPrice')
              ),
          },
          { key: 'merchants', header: t('plans.merchants'), cell: (p) => p.merchantCount },
        ]}
      />
      {editing ? (
        <PlanDialog plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function PlanDialog({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const [v, setV] = useState({
    code: plan?.code ?? '',
    nameEn: plan?.nameEn ?? '',
    nameAr: plan?.nameAr ?? '',
    descriptionEn: plan?.descriptionEn ?? '',
    descriptionAr: plan?.descriptionAr ?? '',
    status: plan?.status ?? 'active',
    isDefault: plan?.isDefault ?? false,
    isPublic: plan?.isPublic ?? true,
    limits: Object.fromEntries(
      PLAN_LIMITS.map((k) => [k, plan?.limits[k] == null ? '' : String(plan.limits[k])]),
    ) as Record<(typeof PLAN_LIMITS)[number], string>,
    features: plan?.features ?? [],
    price: plan?.price?.amount ?? '',
    billingPeriod: plan?.billingPeriod ?? '',
    trialDays: String(plan?.trialDays ?? 0),
    sortOrder: String(plan?.sortOrder ?? 100),
  });
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: () => {
      const body: SavePlan = {
        code: v.code,
        nameEn: v.nameEn,
        nameAr: v.nameAr,
        descriptionEn: v.descriptionEn,
        descriptionAr: v.descriptionAr,
        status: v.status,
        isDefault: v.isDefault,
        isPublic: v.isPublic,
        limits: Object.fromEntries(
          PLAN_LIMITS.map((k) => [k, v.limits[k] === '' ? null : Number(v.limits[k])]),
        ) as SavePlan['limits'],
        features: v.features,
        price: v.price,
        billingPeriod: v.billingPeriod === '' ? null : (v.billingPeriod as 'month' | 'year'),
        trialDays: Number(v.trialDays),
        sortOrder: Number(v.sortOrder),
        version: plan?.version ?? 0,
      };
      return api.platform.savePlan(plan?.id ?? null, body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: platformKey });
      notify.ok(t('plans.saved'));
      onClose();
    },
  });
  const text = (
    key:
      | 'code'
      | 'nameEn'
      | 'nameAr'
      | 'descriptionEn'
      | 'descriptionAr'
      | 'price'
      | 'trialDays'
      | 'sortOrder',
    label: string,
    dir?: 'ltr',
  ) => (
    <Field label={label}>
      {(p) => (
        <Input
          {...p}
          {...(dir ? { dir } : {})}
          value={v[key]}
          onChange={(e) => set({ [key]: e.target.value })}
        />
      )}
    </Field>
  );
  const LIMIT_LABEL = {
    branches: 'maxBranches',
    employees: 'maxEmployees',
    products: 'maxProducts',
    registers: 'maxRegisters',
  } as const;
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={plan ? t('plans.edit') : t('plans.new')}
      footer={
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          {t('plans.save')}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {text('code', t('plans.code'), 'ltr')}
        <Field label={t('plans.status')}>
          {(p) => (
            <Select
              {...p}
              value={v.status}
              onChange={(e) => set({ status: e.target.value as 'active' | 'archived' })}
            >
              <option value="active">{t('plans.statusActive')}</option>
              <option value="archived">{t('plans.statusArchived')}</option>
            </Select>
          )}
        </Field>
        {text('nameAr', t('plans.nameAr'))}
        {text('nameEn', t('plans.nameEn'), 'ltr')}
        {text('descriptionAr', t('plans.descriptionAr'))}
        {text('descriptionEn', t('plans.descriptionEn'), 'ltr')}
        {PLAN_LIMITS.map((k) => (
          <Field key={k} label={t(`plans.${LIMIT_LABEL[k]}`)} hint={t('plans.emptyUnlimited')}>
            {(p) => (
              <Input
                {...p}
                type="number"
                min={0}
                dir="ltr"
                value={v.limits[k]}
                onChange={(e) => set({ limits: { ...v.limits, [k]: e.target.value } })}
              />
            )}
          </Field>
        ))}
        <fieldset className="flex flex-col gap-2 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">{t('plans.features')}</legend>
          {PLAN_FEATURES.map((k) => (
            <Checkbox
              key={k}
              label={t(`detail.feature_${k}`)}
              checked={v.features.includes(k)}
              onChange={(e) =>
                set({
                  features: e.target.checked
                    ? [...v.features, k]
                    : v.features.filter((x) => x !== k),
                })
              }
            />
          ))}
        </fieldset>
        {text('price', t('plans.priceLabel'), 'ltr')}
        <Field label={t('plans.period')}>
          {(p) => (
            <Select
              {...p}
              value={v.billingPeriod}
              onChange={(e) => set({ billingPeriod: e.target.value })}
            >
              <option value="">{t('plans.periodNone')}</option>
              <option value="month">{t('plans.month')}</option>
              <option value="year">{t('plans.year')}</option>
            </Select>
          )}
        </Field>
        {text('trialDays', t('plans.trialDays'), 'ltr')}
        {text('sortOrder', t('plans.sortOrder'), 'ltr')}
        <Checkbox
          label={t('plans.isDefault')}
          checked={v.isDefault}
          onChange={(e) => set({ isDefault: e.target.checked })}
        />
        <Checkbox
          label={t('plans.isPublic')}
          checked={v.isPublic}
          onChange={(e) => set({ isPublic: e.target.checked })}
        />
        {save.isError ? (
          <Alert tone="danger" className="sm:col-span-2">
            {message(save.error)}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
