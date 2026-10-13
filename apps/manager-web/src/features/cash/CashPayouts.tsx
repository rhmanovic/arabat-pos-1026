import { ApiError } from '@arabat/api-client';
import {
  CASH_EXPENSE_CATEGORIES,
  type CashBranchTransfer,
  type CashDisbursement,
  type CashOverview,
  type CashPayoutRequest,
} from '@arabat/contracts';
import { Money, MoneyError } from '@arabat/money';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  Input,
  Select,
  Textarea,
} from '@arabat/ui';
import { ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBranchContext, useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';

/**
 * Cash leaving custody (ADR-0091): expenses and supplier payments from a branch treasury,
 * bank deposits, and cash sent between branches (in transit until the other branch counts it).
 */
const cashKey = ['manager', 'cash'] as const;

function minor(value: string): bigint | null {
  try {
    return Money.parse(value.trim(), 'KWD').minor;
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
}

function useDone(onClose: () => void, message: string) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  return {
    onSuccess: async () => {
      notify.ok(message);
      await queryClient.invalidateQueries({ queryKey: cashKey });
      onClose();
    },
    onError: notify.fail,
  };
}

function AmountField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <Field label={t('cashCustody.amount')}>
      {(p) => (
        <Input
          {...p}
          dir="ltr"
          inputMode="decimal"
          className="h-12 text-lg"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

function BranchField({
  overview,
  value,
  onChange,
  label,
  exclude,
}: {
  overview: CashOverview;
  value: string;
  onChange: (v: string) => void;
  label: string;
  exclude?: string;
}) {
  const { i18n } = useTranslation();
  return (
    <Field label={label}>
      {(p) => (
        <Select {...p} value={value} onChange={(e) => onChange(e.target.value)}>
          {overview.branches
            .filter((b) => b.branchId !== exclude)
            .map((b) => (
              <option key={b.branchId} value={b.branchId}>
                {localizedName(b, i18n.language)} —{' '}
                {formatAmount(b.treasury.balance, i18n.language)}
              </option>
            ))}
        </Select>
      )}
    </Field>
  );
}

/** Pays an expense or a supplier from a branch treasury. */
export function DisbursementDialog({
  overview,
  onClose,
}: {
  overview: CashOverview;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const [branchId, setBranchId] = useState(overview.branches[0]!.branchId);
  const [kind, setKind] = useState<'expense' | 'supplier_payment'>('expense');
  const [category, setCategory] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [receipt, setReceipt] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const branch = overview.branches.find((b) => b.branchId === branchId)!;
  const suppliers = useQuery({
    queryKey: [...cashKey, 'suppliers'],
    queryFn: () => api.cash.suppliers(),
    enabled: kind === 'supplier_payment',
  });
  const orders = useQuery({
    queryKey: [...cashKey, 'orders', supplierId],
    queryFn: () => api.cash.payableOrders(supplierId),
    enabled: kind === 'supplier_payment' && Boolean(supplierId),
  });
  const amountMinor = minor(amount);
  // Approval limits (BR-166): above them the payment waits for a second custody holder and
  // must carry a receipt or invoice reference; the owner pays directly.
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const policy = useQuery({
    queryKey: ['manager', 'sales', 'settings'],
    queryFn: () => api.sales.managerSettings(),
  });
  const limit = policy.data
    ? minor(
        kind === 'expense'
          ? policy.data.expenseApprovalLimit.amount
          : policy.data.supplierPaymentApprovalLimit.amount,
      )
    : null;
  const aboveLimit = amountMinor !== null && limit !== null && amountMinor > limit;
  const valid =
    amountMinor !== null &&
    amountMinor > 0n &&
    (kind !== 'expense' || Boolean(category)) &&
    (category !== 'other' || Boolean(description.trim())) &&
    (kind !== 'supplier_payment' || Boolean(supplierId)) &&
    (!aboveLimit || Boolean(receipt.trim()));
  const body = () => ({
    branchId,
    kind,
    ...(kind === 'expense'
      ? { category: category as (typeof CASH_EXPENSE_CATEGORIES)[number] }
      : { supplierId, ...(orderId ? { purchaseOrderId: orderId } : {}) }),
    amount: amount.trim(),
    description: description.trim() || null,
    receiptReference: receipt.trim() || null,
    idempotencyKey,
  });
  const finish = async (message: string) => {
    notify.ok(message);
    await queryClient.invalidateQueries({ queryKey: cashKey });
    onClose();
  };
  const requestApproval = useMutation({
    mutationFn: () => api.cash.requestPayout(body()),
    onSuccess: () => finish(t('cashCustody.sentForApproval')),
    onError: notify.fail,
  });
  const save = useMutation({
    mutationFn: () => api.cash.disburse(body()),
    onSuccess: () => finish(t('cashCustody.paid')),
    onError: (error) => {
      // The server decides: above the limit a non-owner's payment becomes a request.
      if (error instanceof ApiError && error.code === 'APPROVAL_REQUIRED') requestApproval.mutate();
      else notify.fail(error);
    },
  });
  const waits = aboveLimit && !session.isOwner;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('cashCustody.pay')}
      description={t('cashCustody.payHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!valid}
            loading={save.isPending || requestApproval.isPending}
            onClick={() => (waits ? requestApproval.mutate() : save.mutate())}
          >
            {waits ? t('cashCustody.requestApproval') : t('cashCustody.pay')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {policy.data && aboveLimit ? (
          <Alert tone={waits ? 'warning' : 'info'}>
            <span data-testid="approval-limit">
              {t(waits ? 'cashCustody.aboveLimit' : 'cashCustody.aboveLimitOwner', {
                amount: formatAmount(
                  kind === 'expense'
                    ? policy.data.expenseApprovalLimit
                    : policy.data.supplierPaymentApprovalLimit,
                  i18n.language,
                ),
              })}
            </span>
          </Alert>
        ) : null}
        {overview.branches.length > 1 ? (
          <BranchField
            overview={overview}
            value={branchId}
            onChange={setBranchId}
            label={t('cashCustody.fromTreasury')}
          />
        ) : (
          <p className="text-sm text-fg-muted">
            {t('cashCustody.treasuryBalance', {
              amount: formatAmount(branch.treasury.balance, i18n.language),
            })}
          </p>
        )}
        {!branch.treasury.countedAt ? (
          <Alert tone="warning">{t('cashCustody.countTreasuryFirst')}</Alert>
        ) : null}
        <Field label={t('cashCustody.payKind')}>
          {(p) => (
            <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="expense">{t('cashCustody.kind_expense')}</option>
              <option value="supplier_payment">{t('cashCustody.kind_supplier_payment')}</option>
            </Select>
          )}
        </Field>
        {kind === 'expense' ? (
          <Field label={t('cashCustody.category')}>
            {(p) => (
              <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">{t('cashCustody.choose')}</option>
                {CASH_EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`cashCustody.category_${c}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <>
            <Field label={t('cashCustody.supplier')}>
              {(p) => (
                <Select
                  {...p}
                  value={supplierId}
                  onChange={(e) => {
                    setSupplierId(e.target.value);
                    setOrderId('');
                  }}
                >
                  <option value="">{t('cashCustody.choose')}</option>
                  {(suppliers.data?.suppliers ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {localizedName(s, i18n.language)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {supplierId ? (
              <Field label={t('cashCustody.purchaseOrder')}>
                {(p) => (
                  <Select {...p} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                    <option value="">{t('cashCustody.noOrder')}</option>
                    {(orders.data?.orders ?? []).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.number}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
          </>
        )}
        <AmountField value={amount} onChange={setAmount} />
        <Field label={t('cashCustody.description')}>
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('cashCustody.receiptReference')}
          error={aboveLimit && !receipt.trim() ? t('cashCustody.receiptRequired') : undefined}
        >
          {(p) => (
            <Input {...p} dir="ltr" value={receipt} onChange={(e) => setReceipt(e.target.value)} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/** Treasury payments waiting for a second custody holder (BR-166). */
export function PayoutRequestList() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { branchId } = useBranchContext();
  const { session } = useSession();
  const [deciding, setDeciding] = useState<CashPayoutRequest | null>(null);
  const list = useQuery({
    queryKey: [...cashKey, 'payout-requests', branchId],
    queryFn: () =>
      api.cash.payoutRequests({ ...(branchId ? { branchId } : {}), status: 'pending' }),
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => api.cash.withdrawPayoutRequest(id),
    onSuccess: async () => {
      notify.ok(t('cashCustody.requestWithdrawn'));
      await queryClient.invalidateQueries({ queryKey: cashKey });
    },
    onError: notify.fail,
  });
  if (!list.data?.requests.length) return null;
  return (
    <section
      className="rounded-lg border border-warning/40 bg-surface"
      data-testid="payout-requests"
    >
      <h2 className="border-b border-border px-4 py-3 font-semibold">
        {t('cashCustody.awaitingApproval')}
      </h2>
      <ul className="divide-y divide-border">
        {list.data.requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">
                {t(`cashCustody.kind_${r.kind}`)}
                {r.supplier ? ` · ${localizedName(r.supplier, i18n.language)}` : ''}
                {r.category ? ` · ${t(`cashCustody.category_${r.category}`)}` : ''}
                {r.purchaseOrder ? ` · ${r.purchaseOrder.number}` : ''}
              </span>
              <span className="block text-xs text-fg-muted">
                {r.requestedBy} · {formatDateTime(r.createdAt, i18n.language)} ·{' '}
                {localizedName(r.branch, i18n.language)}
                {r.description ? ` — ${r.description}` : ''}
              </span>
            </span>
            <span dir="ltr" className="font-semibold tabular-nums">
              {formatAmount(r.amount, i18n.language)}
            </span>
            {r.requestedByUserId === session.actor.id && !session.isOwner ? (
              <Button
                size="sm"
                variant="secondary"
                loading={withdraw.isPending}
                onClick={() => withdraw.mutate(r.id)}
              >
                {t('cashCustody.withdraw')}
              </Button>
            ) : (
              <Button size="sm" onClick={() => setDeciding(r)} data-testid="decide-payout">
                {t('cashCustody.decide')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {deciding ? (
        <PayoutDecisionDialog request={deciding} onClose={() => setDeciding(null)} />
      ) : null}
    </section>
  );
}

function PayoutDecisionDialog({
  request,
  onClose,
}: {
  request: CashPayoutRequest;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      api.cash.decidePayoutRequest(request.id, { decision, note: note.trim() || null }),
    onSuccess: async () => {
      notify.ok(t('cashCustody.decided'));
      await queryClient.invalidateQueries({ queryKey: cashKey });
      onClose();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('cashCustody.decideTitle')}
      description={t('cashCustody.decideHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={!note.trim()}
            loading={decide.isPending}
            onClick={() => decide.mutate('reject')}
          >
            {t('cashCustody.reject')}
          </Button>
          <Button loading={decide.isPending} onClick={() => decide.mutate('approve')}>
            {t('cashCustody.approve')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="text-sm">
          {t(`cashCustody.kind_${request.kind}`)} ·{' '}
          <span dir="ltr">{formatAmount(request.amount, i18n.language)}</span> ·{' '}
          {request.requestedBy}
          {request.receiptReference ? ` · ${request.receiptReference}` : ''}
          {request.description ? ` — ${request.description}` : ''}
        </p>
        <Field label={t('cashCustody.description')}>
          {(p) => (
            <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/** Deposits cash from a branch treasury into a bank account (`cash.deposit`). */
export function DepositDialog({
  overview,
  onClose,
}: {
  overview: CashOverview;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const [branchId, setBranchId] = useState(overview.branches[0]!.branchId);
  const [bankId, setBankId] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const branch = overview.branches.find((b) => b.branchId === branchId)!;
  const banks = useQuery({
    queryKey: [...cashKey, 'banks'],
    queryFn: () => api.cash.bankAccounts(),
  });
  const amountMinor = minor(amount);
  const save = useMutation({
    mutationFn: () =>
      api.cash.deposit({
        fromAccountId: branch.treasury.accountId,
        bankAccountId: bankId,
        amount: amount.trim(),
        reference: reference.trim() || null,
        note: note.trim() || null,
        idempotencyKey,
      }),
    ...useDone(onClose, t('cashCustody.deposited')),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('cashCustody.deposit')}
      description={t('cashCustody.depositHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!bankId || amountMinor === null || amountMinor <= 0n}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('cashCustody.deposit')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <BranchField
          overview={overview}
          value={branchId}
          onChange={setBranchId}
          label={t('cashCustody.fromTreasury')}
        />
        <Field label={t('cashCustody.bankAccount')}>
          {(p) => (
            <Select {...p} value={bankId} onChange={(e) => setBankId(e.target.value)}>
              <option value="">{t('cashCustody.choose')}</option>
              {(banks.data?.accounts ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {localizedName(b, i18n.language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <AmountField value={amount} onChange={setAmount} />
        <Field label={t('cashCustody.depositReference')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('cashCustody.note')}>
          {(p) => (
            <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/** Sends cash from one branch treasury to another (it waits in transit until received). */
export function SendToBranchDialog({
  overview,
  onClose,
}: {
  overview: CashOverview;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const [from, setFrom] = useState(overview.branches[0]!.branchId);
  const [to, setTo] = useState(overview.branches[1]?.branchId ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const amountMinor = minor(amount);
  const save = useMutation({
    mutationFn: () =>
      api.cash.sendToBranch({
        fromBranchId: from,
        toBranchId: to,
        amount: amount.trim(),
        note: note.trim() || null,
        idempotencyKey,
      }),
    ...useDone(onClose, t('cashCustody.sent')),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('cashCustody.sendToBranch')}
      description={t('cashCustody.sendHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!to || to === from || amountMinor === null || amountMinor <= 0n}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('cashCustody.send')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <BranchField
          overview={overview}
          value={from}
          onChange={(v) => {
            setFrom(v);
            if (v === to) setTo(overview.branches.find((b) => b.branchId !== v)?.branchId ?? '');
          }}
          label={t('cashCustody.fromTreasury')}
        />
        <BranchField
          overview={overview}
          value={to}
          onChange={setTo}
          exclude={from}
          label={t('cashCustody.toBranch')}
        />
        <AmountField value={amount} onChange={setAmount} />
        <Field label={t('cashCustody.note')}>
          {(p) => (
            <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/** Expenses and supplier payments, with reversal. */
export function DisbursementList() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { branchId } = useBranchContext();
  const [kind, setKind] = useState('');
  const [reversing, setReversing] = useState<CashDisbursement | null>(null);
  const list = useQuery({
    queryKey: [...cashKey, 'disbursements', branchId, kind],
    queryFn: () =>
      api.cash.disbursements({
        ...(branchId ? { branchId } : {}),
        ...(kind ? { kind: kind as CashDisbursement['kind'] } : {}),
        pageSize: 100,
      }),
  });
  const fmt = (v: { amount: string; currency: string }) => formatAmount(v, i18n.language);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label={t('cashCustody.payKind')}>
          {(p) => (
            <Select {...p} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">{t('cashCustody.allKinds')}</option>
              <option value="expense">{t('cashCustody.kind_expense')}</option>
              <option value="supplier_payment">{t('cashCustody.kind_supplier_payment')}</option>
            </Select>
          )}
        </Field>
        {list.data ? (
          <p className="text-sm" data-testid="disbursements-total">
            {t('cashCustody.netPaid')}{' '}
            <span dir="ltr" className="font-semibold tabular-nums">
              {fmt(list.data.netTotal)}
            </span>
          </p>
        ) : null}
      </div>
      <DataTable
        caption={t('cashCustody.tabPayouts')}
        loading={list.isPending}
        error={
          list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : null
        }
        rows={list.data?.disbursements}
        rowKey={(r) => r.id}
        empty={t('cashCustody.noPayouts')}
        columns={[
          {
            key: 'when',
            header: t('cashCustody.when'),
            cell: (r) => (
              <span>
                {new Date(r.createdAt).toLocaleString(i18n.language, { numberingSystem: 'latn' })}
                <span className="block text-xs text-fg-muted" dir="ltr">
                  {r.number}
                </span>
              </span>
            ),
          },
          {
            key: 'what',
            header: t('cashCustody.what'),
            cell: (r) => (
              <span>
                {r.kind === 'expense'
                  ? t(`cashCustody.category_${r.category}`)
                  : localizedName(r.supplier!, i18n.language)}
                {r.reversesId ? (
                  <Badge tone="warning" className="ms-2">
                    {t('cashCustody.reversal')}
                  </Badge>
                ) : null}
                {r.reversedById ? (
                  <Badge tone="neutral" className="ms-2">
                    {t('cashCustody.reversed')}
                  </Badge>
                ) : null}
                <span className="block text-xs text-fg-muted">
                  {[
                    r.kind === 'expense'
                      ? t('cashCustody.kind_expense')
                      : t('cashCustody.kind_supplier_payment'),
                    r.purchaseOrder?.number,
                    r.description,
                    r.receiptReference,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            ),
          },
          {
            key: 'source',
            header: t('cashCustody.paidFrom'),
            hideBelow: 'md',
            cell: (r) => (
              <span>
                {r.source.kind === 'treasury'
                  ? t('cashCustody.treasury')
                  : localizedName(r.source, i18n.language)}
                <span className="block text-xs text-fg-muted">
                  {localizedName(r.branch, i18n.language)} · {r.createdBy}
                </span>
              </span>
            ),
          },
          {
            key: 'amount',
            header: t('cashCustody.amount'),
            cell: (r) => (
              <span dir="ltr" className="tabular-nums">
                {r.reversesId ? '+' : '−'}
                {fmt(r.amount)}
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            cell: (r) =>
              !r.reversesId && !r.reversedById ? (
                <Button size="sm" variant="ghost" onClick={() => setReversing(r)}>
                  {t('cashCustody.reverse')}
                </Button>
              ) : null,
          },
        ]}
      />
      {reversing ? (
        <ReverseDialog disbursement={reversing} onClose={() => setReversing(null)} />
      ) : null}
    </div>
  );
}

function ReverseDialog({
  disbursement,
  onClose,
}: {
  disbursement: CashDisbursement;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const [reason, setReason] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const save = useMutation({
    mutationFn: () => api.cash.reverse(disbursement.id, { reason: reason.trim(), idempotencyKey }),
    ...useDone(onClose, t('cashCustody.reversedDone')),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('cashCustody.reverseTitle', { number: disbursement.number })}
      description={t('cashCustody.reverseHint', {
        amount: formatAmount(disbursement.amount, i18n.language),
      })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={!reason.trim()}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('cashCustody.reverse')}
          </Button>
        </>
      }
    >
      <Field label={t('cashCustody.reason')}>
        {(p) => (
          <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        )}
      </Field>
    </Dialog>
  );
}

const STATUS_TONE = { in_transit: 'warning', received: 'success', cancelled: 'neutral' } as const;

/** Branch-to-branch transfers: the receiving branch confirms, the sender may cancel. */
export function BranchTransferList() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { branchId } = useBranchContext();
  const [acting, setActing] = useState<{
    transfer: CashBranchTransfer;
    action: 'receive' | 'cancel';
  } | null>(null);
  const list = useQuery({
    queryKey: [...cashKey, 'branch-transfers', branchId],
    queryFn: () => api.cash.branchTransfers({ branchId, pageSize: 100 }),
  });
  const fmt = (v: { amount: string; currency: string }) => formatAmount(v, i18n.language);
  return (
    <>
      <DataTable
        caption={t('cashCustody.tabBranchTransfers')}
        loading={list.isPending}
        error={
          list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : null
        }
        rows={list.data?.transfers}
        rowKey={(r) => r.id}
        empty={t('cashCustody.noBranchTransfers')}
        columns={[
          {
            key: 'when',
            header: t('cashCustody.when'),
            cell: (r) => (
              <span>
                {new Date(r.sentAt).toLocaleString(i18n.language, { numberingSystem: 'latn' })}
                <span className="block text-xs text-fg-muted" dir="ltr">
                  {r.number}
                </span>
              </span>
            ),
          },
          {
            key: 'route',
            header: t('cashCustody.route'),
            cell: (r) => (
              <span>
                {t('cashCustody.routeText', {
                  from: localizedName(r.fromBranch, i18n.language),
                  to: localizedName(r.toBranch, i18n.language),
                })}
                <span className="block text-xs text-fg-muted">
                  {[r.sentBy, r.sendNote, r.receiveNote, r.cancelNote].filter(Boolean).join(' · ')}
                </span>
              </span>
            ),
          },
          {
            key: 'amount',
            header: t('cashCustody.amount'),
            cell: (r) => (
              <span dir="ltr" className="tabular-nums">
                {fmt(r.amountSent)}
                {r.difference && r.difference.amount !== '0.000' ? (
                  <span className="block text-xs text-fg-muted">
                    {t('cashCustody.receivedAmount', { amount: fmt(r.amountReceived!) })}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            key: 'status',
            header: t('cashCustody.status'),
            cell: (r) => (
              <Badge tone={STATUS_TONE[r.status]}>{t(`cashCustody.status_${r.status}`)}</Badge>
            ),
          },
          {
            key: 'actions',
            header: '',
            cell: (r) =>
              r.status === 'in_transit' ? (
                <span className="flex gap-1">
                  <Button size="sm" onClick={() => setActing({ transfer: r, action: 'receive' })}>
                    {t('cashCustody.receive')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setActing({ transfer: r, action: 'cancel' })}
                  >
                    {t('cashCustody.cancelTransfer')}
                  </Button>
                </span>
              ) : null,
          },
        ]}
      />
      {acting ? <BranchTransferActionDialog {...acting} onClose={() => setActing(null)} /> : null}
    </>
  );
}

function BranchTransferActionDialog({
  transfer,
  action,
  onClose,
}: {
  transfer: CashBranchTransfer;
  action: 'receive' | 'cancel';
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const [amount, setAmount] = useState(action === 'receive' ? transfer.amountSent.amount : '');
  const [note, setNote] = useState('');
  const receivedMinor = minor(amount);
  const difference =
    action === 'receive' && receivedMinor !== null
      ? receivedMinor - minor(transfer.amountSent.amount)!
      : 0n;
  const save = useMutation({
    mutationFn: () =>
      action === 'receive'
        ? api.cash.receiveFromBranch(transfer.id, {
            receivedAmount: amount.trim(),
            note: note.trim() || null,
            version: transfer.version,
          })
        : api.cash.cancelBranchTransfer(transfer.id, {
            note: note.trim(),
            version: transfer.version,
          }),
    ...useDone(
      onClose,
      action === 'receive' ? t('cashCustody.receivedDone') : t('cashCustody.cancelledDone'),
    ),
  });
  const valid =
    action === 'receive'
      ? receivedMinor !== null && receivedMinor >= 0n && (difference === 0n || Boolean(note.trim()))
      : Boolean(note.trim());
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={
        action === 'receive'
          ? t('cashCustody.receiveTitle', { number: transfer.number })
          : t('cashCustody.cancelTitle', { number: transfer.number })
      }
      description={
        action === 'receive'
          ? t('cashCustody.receiveHint', {
              amount: formatAmount(transfer.amountSent, i18n.language),
            })
          : t('cashCustody.cancelHint')
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={action === 'cancel' ? 'danger' : 'primary'}
            disabled={!valid}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {action === 'receive' ? t('cashCustody.receive') : t('cashCustody.cancelTransfer')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {action === 'receive' ? (
          <Field label={t('cashCustody.countedCash')}>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                inputMode="decimal"
                className="h-12 text-lg"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        {difference !== 0n ? (
          <Alert tone="warning">
            {t('cashCustody.difference', {
              amount: formatAmount(Money.ofMinor(difference, 'KWD').toJSON(), i18n.language),
            })}
          </Alert>
        ) : null}
        <Field label={t('cashCustody.note')}>
          {(p) => (
            <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
