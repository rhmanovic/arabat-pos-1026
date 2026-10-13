import type { PlatformMerchantDetail, SubscriptionView } from '@arabat/contracts';
import { PLAN_FEATURES, PLAN_LIMITS, SUBSCRIPTION_STATUSES } from '@arabat/contracts';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  Field,
  Input,
  PageHeader,
  Section,
  Select,
  Spinner,
  Textarea,
} from '@arabat/ui';
import { ErrorState, useApi, useErrorMessage, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { MERCHANT_TONE, SUB_TONE, platformKey, useFormat, useRole } from '../shared.js';

type MerchantStatus = PlatformMerchantDetail['status'];

export function MerchantDetailPage() {
  const { t } = useTranslation();
  const api = useApi();
  const f = useFormat();
  const { can } = useRole();
  const { merchantId = '' } = useParams();
  const [statusTarget, setStatusTarget] = useState<MerchantStatus | null>(null);
  const [ownerAction, setOwnerAction] = useState<'freeze' | 'release' | 'transfer' | null>(null);
  const [editing, setEditing] = useState(false);
  const detail = useQuery({
    queryKey: [...platformKey, 'merchant', merchantId],
    queryFn: () => api.platform.merchant(merchantId),
  });
  if (detail.isPending) return <Spinner label={t('common:status.loading')} />;
  if (detail.isError)
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  const m = detail.data;
  const s = m.subscription;
  const yes = (v: boolean) => (v ? t('detail.yes') : t('detail.no'));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {f.name(m)}
            <Badge tone={MERCHANT_TONE[m.status]} data-testid="merchant-status">
              {t(`status.${m.status}`)}
            </Badge>
          </span>
        }
        description={
          <Link to="/merchants" className="text-primary hover:underline">
            {t('detail.back')}
          </Link>
        }
        actions={
          m.status === 'closed' ? null : (
            <>
              {can('platform.super_admin', 'platform.support') ? (
                m.status === 'active' ? (
                  <Button variant="secondary" onClick={() => setStatusTarget('suspended')}>
                    {t('detail.suspend')}
                  </Button>
                ) : (
                  <Button onClick={() => setStatusTarget('active')}>
                    {t('detail.reactivate')}
                  </Button>
                )
              ) : null}
              {can('platform.super_admin', 'platform.support') ? (
                m.ownerFrozenAt ? (
                  <Button onClick={() => setOwnerAction('release')}>
                    {t('detail.releaseOwner')}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => setOwnerAction('freeze')}>
                    {t('detail.freezeOwner')}
                  </Button>
                )
              ) : null}
              {can('platform.super_admin') ? (
                <Button variant="secondary" onClick={() => setOwnerAction('transfer')}>
                  {t('detail.transferOwner')}
                </Button>
              ) : null}
              {can('platform.super_admin') ? (
                <Button variant="danger" onClick={() => setStatusTarget('closed')}>
                  {t('detail.close')}
                </Button>
              ) : null}
            </>
          )
        }
      />
      {m.ownerFrozenAt ? (
        <Alert tone="warning" title={t('detail.ownerFrozen', { when: f.date(m.ownerFrozenAt) })}>
          {m.ownerFrozenReason}
        </Alert>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('detail.profile')}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-fg-muted">{t('detail.legalName')}</dt>
            <dd>{m.legalName ?? '—'}</dd>
            <dt className="text-fg-muted">{t('detail.contact')}</dt>
            <dd dir="ltr" className="text-start">
              {[m.contactEmail, m.contactPhone].filter(Boolean).join(' · ') || '—'}
            </dd>
            <dt className="text-fg-muted">{t('detail.language')}</dt>
            <dd>{m.defaultLanguage === 'ar' ? 'العربية' : 'English'}</dd>
            <dt className="text-fg-muted">{t('detail.created')}</dt>
            <dd>{f.date(m.createdAt)}</dd>
            <dt className="text-fg-muted">{t('detail.owner')}</dt>
            <dd>
              {m.owner ? (
                <>
                  {m.owner.fullName} · <span dir="ltr">{m.owner.email}</span>
                </>
              ) : (
                t('detail.noOwner')
              )}
            </dd>
            <dt className="text-fg-muted">{t('detail.lastLogin')}</dt>
            <dd>{m.owner?.lastLoginAt ? f.date(m.owner.lastLoginAt) : t('detail.never')}</dd>
          </dl>
        </Section>
        <Section title={t('detail.onboarding')}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-fg-muted">{t('detail.ownerSignedIn')}</dt>
            <dd>{yes(m.onboarding.ownerSignedIn)}</dd>
            <dt className="text-fg-muted">{t('detail.hasProducts')}</dt>
            <dd>{yes(m.onboarding.hasProducts)}</dd>
            <dt className="text-fg-muted">{t('detail.hasSales')}</dt>
            <dd>{m.onboarding.firstSaleAt ? f.date(m.onboarding.firstSaleAt) : t('detail.no')}</dd>
            <dt className="text-fg-muted">{t('detail.sales30')}</dt>
            <dd className="tabular-nums">{m.onboarding.salesLast30Days}</dd>
            <dt className="text-fg-muted">{t('detail.store')}</dt>
            <dd>{t(`detail.store_${m.onboarding.onlineStoreStatus}`)}</dd>
          </dl>
        </Section>
        <Section
          title={t('detail.subscription')}
          actions={
            can('platform.super_admin', 'platform.billing') ? (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                {t('detail.changeSubscription')}
              </Button>
            ) : null
          }
        >
          <div className="flex flex-col gap-2 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{f.planName(s.plan)}</span>
              <Badge tone={SUB_TONE[s.effectiveStatus]} data-testid="subscription-status">
                {t(`sub.${s.effectiveStatus}`)}
              </Badge>
            </p>
            <p className="text-fg-muted">
              {[
                t('detail.period', { start: f.date(s.startsAt) }),
                s.trialEndsAt ? t('detail.trialEnds', { date: f.date(s.trialEndsAt) }) : null,
                s.endsAt ? t('detail.ends', { date: f.date(s.endsAt) }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <UsageList subscription={s} />
          </div>
        </Section>
        <Section title={t('detail.branchList')}>
          <ul className="flex flex-col gap-1 text-sm">
            {m.branches.map((b) => (
              <li key={b.id} className="flex justify-between gap-2">
                <span>
                  <span dir="ltr">{b.code}</span> · {f.name(b)}
                  {b.status !== 'active' ? ` (${b.status})` : ''}
                </span>
                <span className="text-fg-muted">
                  {t('detail.branchEmployees', { count: b.employees })}
                </span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title={t('detail.history')}>
          <ul className="flex flex-col gap-1 text-sm">
            {m.subscriptionEvents.map((e) => (
              <li key={e.id}>
                <span className="text-fg-muted">{f.date(e.createdAt)}</span> ·{' '}
                {e.kind === 'created'
                  ? t('detail.historyCreated', { plan: e.toPlan })
                  : t('detail.historyChanged', {
                      from: `${e.fromPlan} (${e.fromStatus})`,
                      to: `${e.toPlan} (${e.toStatus})`,
                    })}
                {e.operatorName ? ` · ${e.operatorName}` : ''}
                {e.reason ? ` — ${e.reason}` : ''}
              </li>
            ))}
          </ul>
        </Section>
        <Section title={t('detail.audit')}>
          <ul className="flex flex-col gap-1 text-sm">
            {m.audit.map((a) => (
              <li key={a.id}>
                <span className="text-fg-muted">{f.date(a.occurredAt)}</span> ·{' '}
                <span dir="ltr">{a.action}</span>
                {a.actorName ? ` · ${a.actorName}` : ''}
                {typeof a.details['reason'] === 'string' ? ` — ${a.details['reason']}` : ''}
              </li>
            ))}
          </ul>
        </Section>
      </div>
      {statusTarget ? (
        <StatusDialog merchant={m} target={statusTarget} onClose={() => setStatusTarget(null)} />
      ) : null}
      {ownerAction ? (
        <OwnerDialog merchant={m} action={ownerAction} onClose={() => setOwnerAction(null)} />
      ) : null}
      {editing ? <SubscriptionDialog merchant={m} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}

export function UsageList({ subscription: s }: { subscription: SubscriptionView }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="mt-2 font-medium">{t('detail.usage')}</p>
      <ul className="flex flex-col gap-1">
        {PLAN_LIMITS.map((k) => {
          const u = s.usage[k];
          const full = u.max !== null && u.used >= u.max;
          return (
            <li key={k} className="flex justify-between gap-2" data-testid={`usage-${k}`}>
              <span>{t(`detail.limit_${k}`)}</span>
              <span className={full ? 'font-medium text-warning tabular-nums' : 'tabular-nums'}>
                {u.used} / {u.max ?? t('detail.unlimited')}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 font-medium">{t('detail.features')}</p>
      <p className="flex flex-wrap gap-1">
        {PLAN_FEATURES.map((k) => (
          <Badge key={k} tone={s.plan.features.includes(k) ? 'success' : 'neutral'}>
            {t(`detail.feature_${k}`)}
          </Badge>
        ))}
      </p>
    </>
  );
}

function StatusDialog({
  merchant,
  target,
  onClose,
}: {
  merchant: PlatformMerchantDetail;
  target: MerchantStatus;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const f = useFormat();
  const notify = useNotify();
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const change = useMutation({
    mutationFn: () =>
      api.platform.setStatus(merchant.id, { status: target, reason, version: merchant.version }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: platformKey });
      notify.ok(t('statusDialog.done'));
      onClose();
    },
  });
  const key = target === 'active' ? 'reactivate' : target === 'suspended' ? 'suspend' : 'close';
  return (
    <Dialog
      open
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={t(`statusDialog.${key}`, { name: f.name(merchant) })}
      footer={
        <Button
          variant={target === 'active' ? 'primary' : 'danger'}
          loading={change.isPending}
          disabled={reason.trim().length < 3}
          onClick={() => change.mutate()}
        >
          {t('statusDialog.confirm')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Alert tone={target === 'active' ? 'info' : 'warning'}>
          {t(`statusDialog.${key}Hint`)}
        </Alert>
        <Field label={t('statusDialog.reason')}>
          {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {change.isError ? <Alert tone="danger">{message(change.error)}</Alert> : null}
      </div>
    </Dialog>
  );
}

const toLocal = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
const fromLocal = (date: string) => (date ? new Date(`${date}T23:59:59.000Z`).toISOString() : null);

function SubscriptionDialog({
  merchant,
  onClose,
}: {
  merchant: PlatformMerchantDetail;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const f = useFormat();
  const notify = useNotify();
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const s = merchant.subscription;
  const plans = useQuery({
    queryKey: [...platformKey, 'plans'],
    queryFn: () => api.platform.plans(),
  });
  const [planId, setPlanId] = useState(s.plan.id);
  const [status, setStatus] = useState(s.status);
  const [trialEndsAt, setTrialEndsAt] = useState(toLocal(s.trialEndsAt));
  const [endsAt, setEndsAt] = useState(toLocal(s.endsAt));
  const [reason, setReason] = useState('');
  const check = useQuery({
    queryKey: [...platformKey, 'plan-check', merchant.id, planId],
    queryFn: () => api.platform.planCheck(merchant.id, planId),
  });
  const save = useMutation({
    mutationFn: () =>
      api.platform.changeSubscription(merchant.id, {
        planId,
        status,
        trialEndsAt: status === 'trialing' ? fromLocal(trialEndsAt) : null,
        endsAt: fromLocal(endsAt),
        reason,
        version: s.version,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: platformKey });
      notify.ok(t('subDialog.done'));
      onClose();
    },
  });
  const blocked = check.data ? !check.data.fits : false;
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={t('subDialog.title', { name: f.name(merchant) })}
      footer={
        <Button
          loading={save.isPending}
          disabled={blocked || reason.trim().length < 3 || (status === 'trialing' && !trialEndsAt)}
          onClick={() => save.mutate()}
        >
          {t('subDialog.save')}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('subDialog.plan')}>
          {(p) => (
            <Select {...p} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.data?.plans
                .filter((x) => x.status === 'active' || x.id === s.plan.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {f.planName(x)}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label={t('subDialog.status')}>
          {(p) => (
            <Select
              {...p}
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              {SUBSCRIPTION_STATUSES.map((x) => (
                <option key={x} value={x}>
                  {t(`sub.${x}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {status === 'trialing' ? (
          <Field label={t('subDialog.trialEndsAt')}>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={trialEndsAt}
                onChange={(e) => setTrialEndsAt(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        <Field label={t('subDialog.endsAt')}>
          {(p) => (
            <Input {...p} type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          )}
        </Field>
        <div className="sm:col-span-2" data-testid="plan-check">
          <p className="mb-1 text-sm font-medium">{t('subDialog.check')}</p>
          {check.data ? (
            check.data.fits ? (
              <Alert tone="success">
                {t(`subDialog.direction_${check.data.direction}`)} — {t('subDialog.fits')}
              </Alert>
            ) : (
              <Alert tone="warning" title={t(`subDialog.direction_${check.data.direction}`)}>
                <ul>
                  {check.data.issues.map((i) => (
                    <li key={i.key}>
                      {i.kind === 'limit'
                        ? t('subDialog.issueLimit', {
                            key: t(`detail.limit_${i.key}`),
                            used: i.used,
                            max: i.max,
                          })
                        : t('subDialog.issueFeature', { key: t(`detail.feature_${i.key}`) })}
                    </li>
                  ))}
                </ul>
              </Alert>
            )
          ) : null}
        </div>
        <Field label={t('subDialog.reason')} className="sm:col-span-2">
          {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <p className="text-sm text-fg-muted sm:col-span-2">{t('subDialog.noBilling')}</p>
        {save.isError ? (
          <Alert tone="danger" className="sm:col-span-2">
            {message(save.error)}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Emergency freeze / release of the owner, or a transfer of ownership with a recorded reason (BR-020). */
function OwnerDialog({
  merchant,
  action,
  onClose,
}: {
  merchant: PlatformMerchantDetail;
  action: 'freeze' | 'release' | 'transfer';
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const f = useFormat();
  const notify = useNotify();
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [toMembershipId, setTo] = useState('');
  const run = useMutation({
    mutationFn: () =>
      action === 'transfer'
        ? api.platform.transferOwnership(merchant.id, {
            toMembershipId,
            reason,
            version: merchant.version,
          })
        : action === 'freeze'
          ? api.platform.freezeOwner(merchant.id, { reason, version: merchant.version })
          : api.platform.releaseOwner(merchant.id, { reason, version: merchant.version }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: platformKey });
      notify.ok(t(`ownerDialog.${action}Done`));
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={t(`ownerDialog.${action}`, { name: f.name(merchant) })}
      footer={
        <Button
          variant={action === 'release' ? 'primary' : 'danger'}
          loading={run.isPending}
          disabled={reason.trim().length < 3 || (action === 'transfer' && !toMembershipId)}
          onClick={() => run.mutate()}
        >
          {t('statusDialog.confirm')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Alert tone={action === 'release' ? 'info' : 'warning'}>
          {t(`ownerDialog.${action}Hint`)}
        </Alert>
        {action === 'transfer' ? (
          <Field label={t('ownerDialog.newOwner')}>
            {(p) => (
              <Select {...p} value={toMembershipId} onChange={(e) => setTo(e.target.value)}>
                <option value="">{t('ownerDialog.chooseMember')}</option>
                {merchant.members
                  .filter((x) => !x.isOwner)
                  .map((x) => (
                    <option key={x.membershipId} value={x.membershipId}>
                      {x.fullName} ({x.email})
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        ) : null}
        <Field label={t('statusDialog.reason')}>
          {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {run.isError ? <Alert tone="danger">{message(run.error)}</Alert> : null}
      </div>
    </Dialog>
  );
}
