import type { CashBranch, CashOverview } from '@arabat/contracts';
import { Money, MoneyError } from '@arabat/money';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
  StatCard,
  Textarea,
} from '@arabat/ui';
import { ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBranchContext, useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import {
  BranchTransferList,
  DepositDialog,
  DisbursementDialog,
  DisbursementList,
  SendToBranchDialog,
} from './CashPayouts.js';
import { CashTabs } from './shared.js';

export const cashKey = ['manager', 'cash'] as const;

type Account = { accountId: string; nameEn: string | null; nameAr: string | null };
type Place = Account & {
  kind: 'treasury' | 'register';
  branchId: string;
  balance: { amount: string; currency: string };
  /** A register with an open shift is counted by its cashier when closing. */
  countable: boolean;
};

function minor(value: string): bigint | null {
  try {
    return Money.parse(value.trim(), 'KWD').minor;
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
}

function placesOf(branch: CashBranch): Place[] {
  return [
    { ...branch.treasury, kind: 'treasury', branchId: branch.branchId, countable: true },
    ...branch.registers.map((r) => ({
      accountId: r.accountId,
      nameEn: r.nameEn,
      nameAr: r.nameAr,
      balance: r.balance,
      kind: 'register' as const,
      branchId: branch.branchId,
      countable: !r.openShift,
    })),
  ];
}

/**
 * Cash custody (ADR-0090): where the company's cash is — each branch treasury and register
 * drawer — with counts, statements and transfers between a register and its treasury.
 */
export function CashCustodyPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { branchId } = useBranchContext();
  const { can } = useSession();
  const [tab, setTab] = useState<'balances' | 'transfers' | 'payouts' | 'branchTransfers'>(
    'balances',
  );
  const [transferOpen, setTransferOpen] = useState(false);
  const [dialog, setDialog] = useState<'pay' | 'deposit' | 'send' | null>(null);
  const [counting, setCounting] = useState<Place | null>(null);
  const [statement, setStatement] = useState<Place | null>(null);
  const overview = useQuery({
    queryKey: [...cashKey, 'overview', branchId],
    queryFn: () => api.cash.overview(branchId),
  });
  const fmt = (v: { amount: string; currency: string }) => formatAmount(v, i18n.language);
  const data = overview.data;
  return (
    <div>
      <PageHeader
        title={t('cashCustody.title')}
        description={t('cashCustody.subtitle')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setTransferOpen(true)} disabled={!data?.branches.length}>
              {t('cashCustody.transfer')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setDialog('pay')}
              disabled={!data?.branches.length}
            >
              {t('cashCustody.pay')}
            </Button>
            {can('cash.deposit') ? (
              <Button
                variant="secondary"
                onClick={() => setDialog('deposit')}
                disabled={!data?.branches.length}
              >
                {t('cashCustody.deposit')}
              </Button>
            ) : null}
            {(data?.branches.length ?? 0) > 1 ? (
              <Button variant="secondary" onClick={() => setDialog('send')}>
                {t('cashCustody.sendToBranch')}
              </Button>
            ) : null}
          </div>
        }
      />
      {overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      ) : null}
      {data ? (
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4">
          <StatCard label={t('cashCustody.total')} value={fmt(data.total)} />
          <StatCard label={t('cashCustody.treasuries')} value={fmt(data.treasuriesTotal)} />
          <StatCard label={t('cashCustody.registers')} value={fmt(data.registersTotal)} />
          <StatCard label={t('cashCustody.inTransit')} value={fmt(data.inTransitTotal)} />
        </div>
      ) : null}
      <CashTabs
        tabs={[
          { key: 'balances', label: t('cashCustody.tabBalances') },
          { key: 'transfers', label: t('cashCustody.tabTransfers') },
          { key: 'payouts', label: t('cashCustody.tabPayouts') },
          { key: 'branchTransfers', label: t('cashCustody.tabBranchTransfers') },
        ]}
        active={tab}
        onChange={(k) => setTab(k as typeof tab)}
      />
      {tab === 'balances' ? (
        <div className="grid gap-4" data-testid="cash-branches">
          {data?.branches.map((b) => (
            <section
              key={b.branchId}
              className="rounded-lg border border-border bg-surface"
              aria-label={localizedName(b, i18n.language)}
            >
              <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <h2 className="font-semibold">{localizedName(b, i18n.language)}</h2>
                <span dir="ltr" className="font-semibold tabular-nums">
                  {fmt(b.total)}
                </span>
              </header>
              <ul className="divide-y divide-border">
                {placesOf(b).map((place) => {
                  const register = b.registers.find((r) => r.accountId === place.accountId);
                  return (
                    <li
                      key={place.accountId}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
                      data-testid={`cash-place-${place.kind}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">
                          {place.kind === 'treasury'
                            ? t('cashCustody.treasury')
                            : localizedName(place, i18n.language)}
                        </span>
                        <span className="flex flex-wrap gap-1 pt-1">
                          {place.kind === 'treasury' && !b.treasury.countedAt ? (
                            <Badge tone="warning">{t('cashCustody.notCounted')}</Badge>
                          ) : null}
                          {register?.openShift ? (
                            <Badge tone="primary">
                              {t('cashCustody.inUse', { name: register.openShift.employeeName })}
                            </Badge>
                          ) : null}
                          {register?.needsCount && !register.openShift ? (
                            <Badge tone="warning">{t('cashCustody.needsCount')}</Badge>
                          ) : null}
                        </span>
                      </span>
                      <span dir="ltr" className="text-lg font-semibold tabular-nums">
                        {fmt(place.balance)}
                      </span>
                      <span className="flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!place.countable}
                          onClick={() => setCounting(place)}
                        >
                          {t('cashCustody.count')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setStatement(place)}>
                          {t('cashCustody.statement')}
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : tab === 'transfers' ? (
        <TransferList />
      ) : tab === 'payouts' ? (
        <DisbursementList />
      ) : (
        <BranchTransferList />
      )}
      {dialog === 'pay' && data ? (
        <DisbursementDialog overview={data} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'deposit' && data ? (
        <DepositDialog overview={data} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'send' && data ? (
        <SendToBranchDialog overview={data} onClose={() => setDialog(null)} />
      ) : null}
      {transferOpen && data ? (
        <TransferDialog overview={data} onClose={() => setTransferOpen(false)} />
      ) : null}
      {counting ? <CountDialog place={counting} onClose={() => setCounting(null)} /> : null}
      {statement ? <StatementDialog place={statement} onClose={() => setStatement(null)} /> : null}
    </div>
  );
}

function TransferList() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { branchId } = useBranchContext();
  const list = useQuery({
    queryKey: [...cashKey, 'transfers', branchId],
    queryFn: () => api.cash.transfers({ branchId }),
  });
  const name = (a: { kind: string; nameEn: string | null; nameAr: string | null }) =>
    localizedName(a, i18n.language);
  return (
    <DataTable
      caption={t('cashCustody.tabTransfers')}
      loading={list.isPending}
      error={
        list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null
      }
      rows={list.data?.transfers}
      rowKey={(r) => r.id}
      empty={t('cashCustody.noTransfers')}
      columns={[
        {
          key: 'when',
          header: t('cashCustody.when'),
          cell: (r) =>
            new Date(r.createdAt).toLocaleString(i18n.language, { numberingSystem: 'latn' }),
        },
        { key: 'from', header: t('cashCustody.from'), cell: (r) => name(r.from) },
        { key: 'to', header: t('cashCustody.to'), cell: (r) => name(r.to) },
        {
          key: 'amount',
          header: t('cashCustody.amount'),
          cell: (r) => (
            <span dir="ltr" className="tabular-nums">
              {formatAmount(r.amount, i18n.language)}
            </span>
          ),
        },
        {
          key: 'by',
          header: t('cashCustody.by'),
          hideBelow: 'md',
          cell: (r) => (
            <span>
              {r.createdBy}
              <span className="block text-xs text-fg-muted">
                {t(`cashCustody.origin_${r.origin}`)}
                {r.note ? ` · ${r.note}` : ''}
              </span>
            </span>
          ),
        },
      ]}
    />
  );
}

function TransferDialog({ overview, onClose }: { overview: CashOverview; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState(overview.branches[0]!.branchId);
  const branch = overview.branches.find((b) => b.branchId === branchId)!;
  const [direction, setDirection] = useState<'toTreasury' | 'toRegister'>('toTreasury');
  const [registerAccount, setRegisterAccount] = useState(branch.registers[0]?.accountId ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  // One key per dialog: a double submit or a retry records the transfer once.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const amountMinor = minor(amount);
  const register = branch.registers.find((r) => r.accountId === registerAccount);
  const save = useMutation({
    mutationFn: () =>
      api.cash.transfer({
        fromAccountId: direction === 'toTreasury' ? registerAccount : branch.treasury.accountId,
        toAccountId: direction === 'toTreasury' ? branch.treasury.accountId : registerAccount,
        amount: amount.trim(),
        note: note.trim() || null,
        idempotencyKey,
      }),
    onSuccess: async () => {
      notify.ok(t('cashCustody.transferred'));
      await queryClient.invalidateQueries({ queryKey: cashKey });
      onClose();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('cashCustody.transfer')}
      description={t('cashCustody.transferHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!register || amountMinor === null || amountMinor <= 0n}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('cashCustody.transfer')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {overview.branches.length > 1 ? (
          <Field label={t('cashCustody.branch')}>
            {(p) => (
              <Select
                {...p}
                value={branchId}
                onChange={(e) => {
                  const next = overview.branches.find((b) => b.branchId === e.target.value)!;
                  setBranchId(next.branchId);
                  setRegisterAccount(next.registers[0]?.accountId ?? '');
                }}
              >
                {overview.branches.map((b) => (
                  <option key={b.branchId} value={b.branchId}>
                    {localizedName(b, i18n.language)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <Field label={t('cashCustody.direction')}>
          {(p) => (
            <Select
              {...p}
              value={direction}
              onChange={(e) => setDirection(e.target.value as typeof direction)}
            >
              <option value="toTreasury">{t('cashCustody.toTreasury')}</option>
              <option value="toRegister">{t('cashCustody.toRegister')}</option>
            </Select>
          )}
        </Field>
        <Field label={t('cashCustody.register')}>
          {(p) => (
            <Select
              {...p}
              value={registerAccount}
              onChange={(e) => setRegisterAccount(e.target.value)}
            >
              {branch.registers.map((r) => (
                <option key={r.accountId} value={r.accountId}>
                  {localizedName(r, i18n.language)} — {formatAmount(r.balance, i18n.language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="text-sm text-fg-muted">
          {t('cashCustody.treasuryBalance', {
            amount: formatAmount(branch.treasury.balance, i18n.language),
          })}
        </p>
        {direction === 'toRegister' && !branch.treasury.countedAt ? (
          <Alert tone="warning">{t('cashCustody.countTreasuryFirst')}</Alert>
        ) : null}
        <Field label={t('cashCustody.amount')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
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

function CountDialog({ place, onClose }: { place: Place; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const countedMinor = counted.trim() ? minor(counted) : null;
  const difference = countedMinor === null ? null : countedMinor - minor(place.balance.amount)!;
  const save = useMutation({
    mutationFn: () =>
      api.cash.count(place.accountId, {
        countedCash: counted.trim(),
        expectedCash: place.balance.amount,
        note: note.trim() || null,
      }),
    onSuccess: async () => {
      notify.ok(t('cashCustody.counted'));
      await queryClient.invalidateQueries({ queryKey: cashKey });
      onClose();
    },
    onError: async (error) => {
      notify.fail(error);
      await queryClient.invalidateQueries({ queryKey: cashKey });
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('cashCustody.countTitle', {
        name:
          place.kind === 'treasury'
            ? t('cashCustody.treasury')
            : localizedName(place, i18n.language),
      })}
      description={t('cashCustody.countHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={countedMinor === null}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('cashCustody.saveCount')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="flex justify-between text-lg">
          <span>{t('cashCustody.expected')}</span>
          <span dir="ltr" className="font-semibold tabular-nums">
            {formatAmount(place.balance, i18n.language)}
          </span>
        </div>
        <Field label={t('cashCustody.countedCash')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              inputMode="decimal"
              className="h-12 text-lg"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
            />
          )}
        </Field>
        {difference !== null && difference !== 0n ? (
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

function StatementDialog({ place, onClose }: { place: Place; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const [page, setPage] = useState(1);
  const statement = useQuery({
    queryKey: [...cashKey, 'statement', place.accountId, page],
    queryFn: () => api.cash.statement(place.accountId, page),
  });
  const pages = statement.data ? Math.max(1, Math.ceil(statement.data.total / 25)) : 1;
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(open) => !open && onClose()}
      title={t('cashCustody.statementTitle', {
        name:
          place.kind === 'treasury'
            ? t('cashCustody.treasury')
            : localizedName(place, i18n.language),
      })}
    >
      <DataTable
        caption={t('cashCustody.statement')}
        loading={statement.isPending}
        error={
          statement.isError ? (
            <ErrorState error={statement.error} onRetry={() => void statement.refetch()} />
          ) : null
        }
        rows={statement.data?.entries}
        rowKey={(e) => e.id}
        empty={t('cashCustody.noEntries')}
        columns={[
          {
            key: 'when',
            header: t('cashCustody.when'),
            cell: (e) =>
              new Date(e.createdAt).toLocaleString(i18n.language, { numberingSystem: 'latn' }),
          },
          {
            key: 'what',
            header: t('cashCustody.what'),
            cell: (e) => (
              <span>
                {t(`cashCustody.source_${e.sourceType}`, { defaultValue: e.sourceType })}
                {e.description ? (
                  <span className="block text-xs text-fg-muted">{e.description}</span>
                ) : null}
              </span>
            ),
          },
          {
            key: 'amount',
            header: t('cashCustody.amount'),
            cell: (e) => (
              <span dir="ltr" className="tabular-nums">
                {formatAmount(e.amount, i18n.language)}
              </span>
            ),
          },
          {
            key: 'balance',
            header: t('cashCustody.balance'),
            hideBelow: 'md',
            cell: (e) => (
              <span dir="ltr" className="tabular-nums">
                {formatAmount(e.balance, i18n.language)}
              </span>
            ),
          },
        ]}
      />
      {pages > 1 ? (
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t('cashCustody.newer')}
          </Button>
          <span className="text-sm text-fg-muted">
            {page} / {pages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            {t('cashCustody.older')}
          </Button>
        </div>
      ) : null}
    </Dialog>
  );
}
