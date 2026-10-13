import type { FinancialAccount } from '@arabat/contracts';
import { Money, MoneyError } from '@arabat/money';
import { Alert, Button, Checkbox, Dialog, Field, Input, Textarea } from '@arabat/ui';
import { ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAmount } from '../catalog/ProductsPage.js';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';
import { paymentsKey } from './PaymentsPage.js';

function signedMinor(value: string): bigint | null {
  const v = value.trim();
  const negative = v.startsWith('-');
  try {
    const minor = Money.parse(negative ? v.slice(1) : v, 'KWD').minor;
    return negative ? -minor : minor;
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Manual bank reconciliation (BR-168): tick the entries that appear on the bank statement,
 * enter the statement balance, explain any difference. Nothing is edited; each reconciliation
 * is a new record.
 */
export function ReconcileDialog({
  account,
  onClose,
}: {
  account: FinancialAccount;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [statementDate, setStatementDate] = useState(today());
  const [statementBalance, setStatementBalance] = useState('');
  const [note, setNote] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const state = useQuery({
    queryKey: [...paymentsKey, 'reconciliation', account.id],
    queryFn: () => api.cash.bankReconciliation(account.id),
  });
  const fmt = (v: { amount: string; currency: string }) => formatAmount(v, i18n.language);
  const tickedTotal = (state.data?.unreconciled ?? [])
    .filter((e) => ticked.has(e.id))
    .reduce((sum, e) => sum + Money.parse(e.amount.amount, 'KWD').minor, 0n);
  const cleared = state.data
    ? Money.parse(state.data.clearedBalance.amount, 'KWD').minor + tickedTotal
    : null;
  const statementMinor = statementBalance.trim() ? signedMinor(statementBalance) : null;
  const difference = cleared !== null && statementMinor !== null ? statementMinor - cleared : null;
  const save = useMutation({
    mutationFn: () =>
      api.cash.reconcileBank(account.id, {
        statementDate,
        statementBalance: statementBalance.trim(),
        entryIds: [...ticked],
        note: note.trim() || null,
      }),
    onSuccess: async () => {
      notify.ok(t('cash.reconciled'));
      await queryClient.invalidateQueries({ queryKey: paymentsKey });
      onClose();
    },
    onError: notify.fail,
  });
  const toggle = (id: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(open) => !open && onClose()}
      title={t('cash.reconcileTitle', { name: localizedName(account, i18n.language) })}
      description={t('cash.reconcileHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={
              statementMinor === null ||
              !state.data ||
              (difference !== null && difference !== 0n && !note.trim())
            }
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('cash.saveReconciliation')}
          </Button>
        </>
      }
    >
      {state.isError ? (
        <ErrorState error={state.error} onRetry={() => void state.refetch()} />
      ) : null}
      {state.data ? (
        <div className="grid gap-4">
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-fg-muted">{t('cash.bookBalance')}</dt>
              <dd dir="ltr" className="font-semibold tabular-nums">
                {fmt(state.data.bookBalance)}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t('cash.clearedBefore')}</dt>
              <dd dir="ltr" className="font-semibold tabular-nums">
                {fmt(state.data.clearedBalance)}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t('cash.lastReconciled')}</dt>
              <dd>
                {state.data.last
                  ? `${state.data.last.statementDate} · ${state.data.last.createdBy}`
                  : t('cash.neverReconciled')}
              </dd>
            </div>
          </dl>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('cash.statementDate')}>
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  dir="ltr"
                  value={statementDate}
                  onChange={(e) => setStatementDate(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('cash.statementBalance')}>
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  inputMode="decimal"
                  value={statementBalance}
                  onChange={(e) => setStatementBalance(e.target.value)}
                />
              )}
            </Field>
          </div>
          <section className="rounded-md border border-border">
            <h3 className="border-b border-border px-3 py-2 text-sm font-semibold">
              {t('cash.unreconciledEntries', { count: state.data.unreconciled.length })}
            </h3>
            {state.data.unreconciled.length === 0 ? (
              <p className="px-3 py-3 text-sm text-fg-muted">{t('cash.nothingToReconcile')}</p>
            ) : (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto">
                {state.data.unreconciled.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                    <Checkbox
                      className="min-w-0 flex-1"
                      checked={ticked.has(e.id)}
                      onChange={(ev) => toggle(e.id, ev.target.checked)}
                      label={
                        <>
                          {t(`cashCustody.source_${e.sourceType}`, { defaultValue: e.sourceType })}
                          {e.reference ? ` · ${e.reference}` : ''}
                        </>
                      }
                      description={`${formatDateTime(e.createdAt, i18n.language)}${
                        e.createdBy ? ` · ${e.createdBy}` : ''
                      }${e.description ? ` — ${e.description}` : ''}`}
                    />
                    <span dir="ltr" className="tabular-nums">
                      {fmt(e.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {cleared !== null ? (
            <p className="text-sm" data-testid="cleared-after">
              {t('cash.clearedAfter', {
                amount: fmt(Money.ofMinor(cleared, 'KWD').toJSON()),
              })}
            </p>
          ) : null}
          {difference !== null && difference !== 0n ? (
            <Alert tone="warning">
              <span data-testid="reconcile-difference">
                {t('cash.reconcileDifference', {
                  amount: fmt(Money.ofMinor(difference, 'KWD').toJSON()),
                })}
              </span>
            </Alert>
          ) : difference === 0n ? (
            <Alert tone="success">{t('cash.reconcileBalanced')}</Alert>
          ) : null}
          <Field label={t('cash.reconcileNote')}>
            {(p) => (
              <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            )}
          </Field>
          {state.data.history.length > 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-fg-muted">
                {t('cash.reconciliationHistory')}
              </summary>
              <ul className="mt-2 divide-y divide-border">
                {state.data.history.map((r) => (
                  <li key={r.id} className="flex flex-wrap gap-x-3 py-1">
                    <span>{r.statementDate}</span>
                    <span dir="ltr" className="tabular-nums">
                      {fmt(r.statementBalance)}
                    </span>
                    <span dir="ltr" className="tabular-nums text-fg-muted">
                      {t('cash.differenceShort', { amount: fmt(r.difference) })}
                    </span>
                    <span className="text-fg-muted">
                      {r.createdBy}
                      {r.note ? ` — ${r.note}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
