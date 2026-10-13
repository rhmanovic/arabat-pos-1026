import {
  FEE_TYPES,
  FINANCIAL_ACCOUNT_KINDS,
  GATEWAY_PROVIDERS,
  PAYMENT_METHOD_KINDS,
  type FinancialAccount,
  type PaymentMethod,
} from '@arabat/contracts';
import { Money, MoneyError, processingFee } from '@arabat/money';
import { formatMoney } from '@arabat/i18n';
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
import { ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { formatAmount } from '../catalog/ProductsPage.js';
import { ReconcileDialog } from './BankReconciliation.js';
import { CashTabs } from './shared.js';

export const paymentsKey = ['manager', 'payments'] as const;
const PERCENT = /^(100(\.0{1,3})?|\d{1,2}(\.\d{1,3})?)$/;

function parseMinor(value: string): bigint | null {
  try {
    return Money.parse(value.trim() || '0', 'KWD').minor;
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
}

export function feeLabel(m: PaymentMethod, t: (k: string) => string, language: string) {
  switch (m.feeType) {
    case 'none':
      return t('cash.fee_none');
    case 'fixed':
      return formatAmount(m.feeFixed, language);
    case 'percentage':
      return `${m.feePercent}%`;
    case 'fixed_plus_percentage':
      return `${formatAmount(m.feeFixed, language)} + ${m.feePercent}%`;
  }
}

/** Payment methods (`/payments`) and the financial accounts they settle into (`/accounts`). */
export function PaymentsPage({ view = 'methods' }: { view?: 'methods' | 'accounts' }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const tab = view;
  const [editing, setEditing] = useState<PaymentMethod | 'new' | null>(null);
  const [account, setAccount] = useState<FinancialAccount | 'new' | null>(null);
  const [reconciling, setReconciling] = useState<FinancialAccount | null>(null);
  const methods = useQuery({
    queryKey: [...paymentsKey, 'methods'],
    queryFn: () => api.payments.methods(),
  });
  const accounts = useQuery({
    queryKey: [...paymentsKey, 'accounts'],
    queryFn: () => api.payments.accounts(),
  });
  const accountName = (id: string | null) => {
    const a = accounts.data?.accounts.find((x) => x.id === id);
    return a ? localizedName(a, i18n.language) : '—';
  };

  return (
    <div>
      <PageHeader
        title={tab === 'methods' ? t('cash.methodsTitle') : t('cash.accountsTitle')}
        description={tab === 'methods' ? t('cash.methodsSubtitle') : t('cash.accountsSubtitle')}
        actions={
          tab === 'methods' ? (
            <Button onClick={() => setEditing('new')}>{t('cash.newMethod')}</Button>
          ) : (
            <Button onClick={() => setAccount('new')}>{t('cash.newAccount')}</Button>
          )
        }
      />
      <CashTabs
        tabs={[
          { key: 'methods', label: t('cash.tabMethods') },
          { key: 'accounts', label: t('cash.tabAccounts') },
        ]}
        active={tab}
        onChange={(k) => void navigate(k === 'accounts' ? '/accounts' : '/payments')}
      />
      {tab === 'methods' ? (
        <DataTable
          caption={t('cash.methodsTitle')}
          loading={methods.isPending}
          error={
            methods.isError ? (
              <ErrorState error={methods.error} onRetry={() => void methods.refetch()} />
            ) : null
          }
          rows={methods.data?.methods}
          rowKey={(m) => m.id}
          onRowClick={setEditing}
          columns={[
            {
              key: 'name',
              header: t('common.name'),
              cell: (m) => <span className="font-medium">{localizedName(m, i18n.language)}</span>,
            },
            { key: 'kind', header: t('cash.kind'), cell: (m) => t(`cash.kind_${m.kind}`) },
            {
              key: 'channels',
              header: t('cash.pos'),
              hideBelow: 'sm',
              cell: (m) => (
                <span className="flex flex-wrap gap-1">
                  {m.availableInPos ? <Badge tone="primary">{t('cash.pos')}</Badge> : null}
                  {m.availableOnline ? <Badge>{t('cash.online')}</Badge> : null}
                </span>
              ),
            },
            {
              key: 'fee',
              header: t('cash.fee'),
              cell: (m) => (
                <span dir="ltr" className="tabular-nums" data-testid="method-fee">
                  {feeLabel(m, t, i18n.language)}
                </span>
              ),
            },
            {
              key: 'account',
              header: t('cash.account'),
              hideBelow: 'lg',
              cell: (m) =>
                m.kind === 'cash' ? t('cash.settlesInDrawer') : accountName(m.financialAccountId),
            },
            {
              key: 'status',
              header: t('common.status'),
              cell: (m) => (
                <Badge tone={m.status === 'active' ? 'success' : 'neutral'}>
                  {m.status === 'active' ? t('common.active') : t('common.inactive')}
                </Badge>
              ),
            },
          ]}
        />
      ) : (
        <>
          <p className="mb-4 text-sm text-fg-muted">{t('cash.accountsSubtitle')}</p>
          <DataTable
            caption={t('cash.accountsTitle')}
            loading={accounts.isPending}
            error={
              accounts.isError ? (
                <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
              ) : null
            }
            rows={accounts.data?.accounts}
            rowKey={(a) => a.id}
            // The archived pre-ADR-0090 cash account is history only.
            onRowClick={(a) => (a.status === 'archived' ? undefined : setAccount(a))}
            columns={[
              {
                key: 'name',
                header: t('common.name'),
                cell: (a) => localizedName(a, i18n.language),
              },
              { key: 'kind', header: t('cash.kind'), cell: (a) => t(`cash.accountKind_${a.kind}`) },
              {
                key: 'balance',
                header: t('cash.balance'),
                cell: (a) => (
                  <span dir="ltr" className="tabular-nums">
                    {formatAmount(a.balance, i18n.language)}
                  </span>
                ),
              },
              {
                key: 'status',
                header: t('common.status'),
                cell: (a) =>
                  a.status === 'archived'
                    ? t('cash.archived')
                    : a.status === 'active'
                      ? t('common.active')
                      : t('common.inactive'),
              },
              {
                key: 'reconcile',
                header: t('cash.reconciliation'),
                cell: (a) =>
                  a.kind === 'bank' && a.status !== 'archived' ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {a.unreconciledEntries > 0 ? (
                        <Badge tone="warning">
                          {t('cash.unreconciledCount', { count: a.unreconciledEntries })}
                        </Badge>
                      ) : a.lastReconciledAt ? (
                        <Badge tone="success">{t('cash.reconciledUpToDate')}</Badge>
                      ) : null}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setReconciling(a);
                        }}
                      >
                        {t('cash.reconcile')}
                      </Button>
                    </span>
                  ) : null,
              },
            ]}
          />
        </>
      )}
      {reconciling ? (
        <ReconcileDialog account={reconciling} onClose={() => setReconciling(null)} />
      ) : null}
      {editing ? (
        <MethodDialog
          method={editing === 'new' ? null : editing}
          accounts={accounts.data?.accounts ?? []}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {account ? (
        <AccountDialog
          account={account === 'new' ? null : account}
          onClose={() => setAccount(null)}
        />
      ) : null}
    </div>
  );
}

function MethodDialog({
  method,
  accounts,
  onClose,
}: {
  method: PaymentMethod | null;
  accounts: FinancialAccount[];
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [v, setV] = useState({
    kind: method?.kind ?? ('card' as PaymentMethod['kind']),
    nameAr: method?.nameAr ?? '',
    nameEn: method?.nameEn ?? '',
    status: method?.status ?? ('active' as const),
    availableInPos: method?.availableInPos ?? true,
    availableOnline: method?.availableOnline ?? false,
    feeType: method?.feeType ?? ('none' as PaymentMethod['feeType']),
    feeFixed: method?.feeFixed.amount ?? '0.000',
    feePercent: method?.feePercent ?? '0',
    financialAccountId: method?.financialAccountId ?? '',
    gatewayProvider: method?.gatewayProvider ?? '',
    refundFeePolicy: method?.refundFeePolicy ?? ('keep' as PaymentMethod['refundFeePolicy']),
  });
  const [previewAmount, setPreviewAmount] = useState('10.000');
  const set = (patch: Partial<typeof v>) => setV((c) => ({ ...c, ...patch }));
  const usesFixed = v.feeType === 'fixed' || v.feeType === 'fixed_plus_percentage';
  const usesPercent = v.feeType === 'percentage' || v.feeType === 'fixed_plus_percentage';
  const fixedMinor = parseMinor(v.feeFixed);
  const percentOk = PERCENT.test(v.feePercent.trim());
  const amountMinor = parseMinor(previewAmount);
  const feeValid = (!usesFixed || fixedMinor !== null) && (!usesPercent || percentOk);
  const valid =
    Boolean(v.nameAr || v.nameEn) &&
    feeValid &&
    // Every non-cash method settles somewhere (BR-181); cash never carries a fee.
    (v.kind === 'cash' ? v.feeType === 'none' : Boolean(v.financialAccountId));
  const fee =
    feeValid && amountMinor !== null
      ? processingFee(amountMinor, {
          type: v.feeType,
          fixedMinor: usesFixed ? fixedMinor! : 0n,
          percent: usesPercent ? v.feePercent.trim() : '0',
        })
      : null;
  const show = (minor: bigint) => formatMoney(Money.ofMinor(minor, 'KWD'), i18n.language);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...v,
        nameAr: v.nameAr || null,
        nameEn: v.nameEn || null,
        financialAccountId: v.kind === 'cash' ? null : v.financialAccountId || null,
        gatewayProvider: (v.gatewayProvider || null) as PaymentMethod['gatewayProvider'],
        feeFixed: v.feeFixed.trim() || '0',
        feePercent: v.feePercent.trim() || '0',
        sortOrder: method?.sortOrder ?? 10,
      };
      return method
        ? api.payments.updateMethod(method.id, { ...body, version: method.version })
        : api.payments.createMethod(body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: paymentsKey });
      notify.ok(t('common.saved'));
      onClose();
    },
    onError: notify.fail,
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={method ? localizedName(method, i18n.language) : t('cash.newMethod')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('cash.kind')}>
          {(p) => (
            <Select
              {...p}
              value={v.kind}
              disabled={method?.kind === 'cash'}
              onChange={(e) => set({ kind: e.target.value as PaymentMethod['kind'] })}
            >
              {PAYMENT_METHOD_KINDS.filter((k) => k !== 'cash' || method?.kind === 'cash').map(
                (k) => (
                  <option key={k} value={k}>
                    {t(`cash.kind_${k}`)}
                  </option>
                ),
              )}
            </Select>
          )}
        </Field>
        <Field label={t('common.status')}>
          {(p) => (
            <Select
              {...p}
              value={v.status}
              onChange={(e) => set({ status: e.target.value as 'active' | 'inactive' })}
            >
              <option value="active">{t('common.active')}</option>
              <option value="inactive">{t('common.inactive')}</option>
            </Select>
          )}
        </Field>
        <Field label={t('common.nameAr')}>
          {(p) => (
            <Input
              {...p}
              dir="rtl"
              value={v.nameAr}
              onChange={(e) => set({ nameAr: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('common.nameEn')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              value={v.nameEn}
              onChange={(e) => set({ nameEn: e.target.value })}
            />
          )}
        </Field>
        <Checkbox
          label={t('cash.availableInPos')}
          checked={v.availableInPos}
          onChange={(e) => set({ availableInPos: e.target.checked })}
        />
        <Checkbox
          label={t('cash.availableOnline')}
          checked={v.availableOnline}
          onChange={(e) => set({ availableOnline: e.target.checked })}
        />
        <Field label={t('cash.feeType')}>
          {(p) => (
            <Select
              {...p}
              value={v.feeType}
              onChange={(e) => set({ feeType: e.target.value as PaymentMethod['feeType'] })}
            >
              {FEE_TYPES.map((f) => (
                <option key={f} value={f}>
                  {t(`cash.fee_${f}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {usesFixed ? (
            <Field
              label={t('cash.feeFixed')}
              error={fixedMinor === null ? t('common:errors.INVALID_PRICE') : undefined}
            >
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  inputMode="decimal"
                  value={v.feeFixed}
                  onChange={(e) => set({ feeFixed: e.target.value })}
                />
              )}
            </Field>
          ) : null}
          {usesPercent ? (
            <Field
              label={t('cash.feePercent')}
              error={percentOk ? undefined : t('common:errors.VALIDATION_FAILED')}
            >
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  inputMode="decimal"
                  value={v.feePercent}
                  onChange={(e) => set({ feePercent: e.target.value })}
                />
              )}
            </Field>
          ) : null}
        </div>
        {v.feeType !== 'none' ? (
          <div className="rounded-md bg-surface-muted p-3 text-sm sm:col-span-2">
            <Field label={t('cash.previewAmount')} className="mb-2 max-w-48">
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  inputMode="decimal"
                  value={previewAmount}
                  onChange={(e) => setPreviewAmount(e.target.value)}
                />
              )}
            </Field>
            {fee !== null && amountMinor !== null ? (
              <p data-testid="fee-preview">
                {t('cash.feePreview', {
                  amount: show(amountMinor),
                  fee: show(fee),
                  net: show(amountMinor - fee),
                })}
              </p>
            ) : null}
          </div>
        ) : null}
        {v.kind === 'cash' ? (
          // Cash settles into the drawer of the register that takes it (ADR-0090).
          <Alert tone="info">{t('cash.settlesInDrawerHint')}</Alert>
        ) : (
          <Field label={t('cash.account')}>
            {(p) => (
              <Select
                {...p}
                value={v.financialAccountId}
                onChange={(e) => set({ financialAccountId: e.target.value })}
              >
                <option value="">{t('cash.noAccount')}</option>
                {accounts
                  .filter(
                    (a) =>
                      (a.status === 'active' && a.kind !== 'cash') || a.id === v.financialAccountId,
                  )
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {localizedName(a, i18n.language)}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
        {v.kind !== 'cash' ? (
          <Field label={t('cash.refundFeePolicy')} hint={t('cash.refundFeePolicyHint')}>
            {(p) => (
              <Select
                {...p}
                value={v.refundFeePolicy}
                onChange={(e) =>
                  set({ refundFeePolicy: e.target.value as PaymentMethod['refundFeePolicy'] })
                }
              >
                <option value="keep">{t('cash.refundFee_keep')}</option>
                <option value="reverse">{t('cash.refundFee_reverse')}</option>
              </Select>
            )}
          </Field>
        ) : null}
        {v.kind !== 'cash' ? (
          <Field label={t('cash.gateway')}>
            {(p) => (
              <Select
                {...p}
                value={v.gatewayProvider}
                onChange={(e) => set({ gatewayProvider: e.target.value })}
              >
                <option value="">{t('cash.gatewayNone')}</option>
                {GATEWAY_PROVIDERS.map((g) => (
                  <option key={g} value={g}>
                    {g === 'mock' ? t('cash.gatewayMock') : g[0]!.toUpperCase() + g.slice(1)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <Alert tone="info" className="sm:col-span-2">
          {v.kind === 'cash' ? t('cash.cashOnlyOne') : t('cash.gatewayNote')}
        </Alert>
      </div>
    </Dialog>
  );
}

function AccountDialog({
  account,
  onClose,
}: {
  account: FinancialAccount | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [v, setV] = useState({
    nameAr: account?.nameAr ?? '',
    nameEn: account?.nameEn ?? '',
    kind: (account?.kind ?? 'bank') as (typeof FINANCIAL_ACCOUNT_KINDS)[number],
    status: (account?.status ?? 'active') as 'active' | 'inactive',
  });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...v, nameAr: v.nameAr || null, nameEn: v.nameEn || null };
      return account
        ? api.payments.updateAccount(account.id, { ...body, version: account.version })
        : api.payments.createAccount(body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: paymentsKey });
      notify.ok(t('common.saved'));
      onClose();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={account ? t('common.edit') : t('cash.newAccount')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!v.nameAr && !v.nameEn}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label={t('common.nameAr')}>
          {(p) => (
            <Input
              {...p}
              dir="rtl"
              value={v.nameAr}
              onChange={(e) => setV({ ...v, nameAr: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('common.nameEn')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              value={v.nameEn}
              onChange={(e) => setV({ ...v, nameEn: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('cash.kind')}>
          {(p) => (
            <Select
              {...p}
              value={v.kind}
              onChange={(e) =>
                setV({ ...v, kind: e.target.value as (typeof FINANCIAL_ACCOUNT_KINDS)[number] })
              }
            >
              {FINANCIAL_ACCOUNT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`cash.accountKind_${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('common.status')}>
          {(p) => (
            <Select
              {...p}
              value={v.status}
              onChange={(e) => setV({ ...v, status: e.target.value as 'active' | 'inactive' })}
            >
              <option value="active">{t('common.active')}</option>
              <option value="inactive">{t('common.inactive')}</option>
            </Select>
          )}
        </Field>
      </div>
    </Dialog>
  );
}
