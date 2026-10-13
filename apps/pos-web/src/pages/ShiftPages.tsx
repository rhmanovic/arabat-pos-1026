import {
  CASH_EXPENSE_CATEGORIES,
  CASH_IN_REASONS,
  CASH_OUT_REASONS,
  type PosShift,
  type Shift,
} from '@arabat/contracts';
import { formatMoney } from '@arabat/i18n';
import { Money, MoneyError } from '@arabat/money';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  Field,
  Input,
  Menu,
  MenuItem,
  Select,
  Spinner,
  Textarea,
} from '@arabat/ui';
import { localizedName, useApi, useAuth, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

export const shiftKey = ['pos', 'shift'] as const;

/** KWD notes and coins for counting the drawer. */
const DENOMINATIONS = [
  '20.000',
  '10.000',
  '5.000',
  '1.000',
  '0.500',
  '0.250',
  '0.100',
  '0.050',
  '0.020',
  '0.010',
  '0.005',
];

function minor(value: string): bigint | null {
  try {
    return Money.parse(value.trim(), 'KWD').minor;
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
}

function useMoney() {
  const { i18n } = useTranslation();
  return (value: { amount: string; currency: string } | bigint) =>
    formatMoney(
      typeof value === 'bigint'
        ? Money.ofMinor(value, 'KWD')
        : Money.fromJSON(value as { amount: string; currency: 'KWD' }),
      i18n.language,
    );
}

/** Counting the drawer: a typed total or a notes-and-coins count (shared by open and close). */
function useCashCount() {
  const [counted, setCounted] = useState('');
  const [byCount, setByCount] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const breakdownTotal = DENOMINATIONS.reduce((sum, d) => {
    const n = /^\d{1,6}$/.test(counts[d] ?? '') ? BigInt(counts[d]!) : 0n;
    return sum + minor(d)! * n;
  }, 0n);
  const countedMinor = byCount ? breakdownTotal : counted.trim() ? minor(counted) : null;
  return {
    counted,
    setCounted,
    byCount,
    setByCount,
    counts,
    setCounts,
    breakdownTotal,
    countedMinor,
    payload: () => ({
      countedCash: Money.ofMinor(countedMinor!, 'KWD').toDecimalString(),
      ...(byCount
        ? {
            breakdown: DENOMINATIONS.map((value) => ({
              value,
              count: /^\d{1,6}$/.test(counts[value] ?? '') ? Number(counts[value]) : 0,
            })),
          }
        : {}),
    }),
  };
}

function CashCountFields({ count }: { count: ReturnType<typeof useCashCount> }) {
  const { t } = useTranslation();
  const fmt = useMoney();
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-5 accent-primary"
          checked={count.byCount}
          onChange={(e) => count.setByCount(e.target.checked)}
        />
        {t('shift.countNotes')}
      </label>
      {count.byCount ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DENOMINATIONS.map((d) => (
            <Field key={d} label={d.replace(/\.?0+$/, '')}>
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  inputMode="numeric"
                  value={count.counts[d] ?? ''}
                  onChange={(e) => count.setCounts((c) => ({ ...c, [d]: e.target.value }))}
                />
              )}
            </Field>
          ))}
          <p className="col-span-full text-lg font-semibold" dir="ltr" data-testid="count-total">
            {t('shift.total')}: {fmt(count.breakdownTotal)}
          </p>
        </div>
      ) : (
        <Field
          label={t('shift.counted')}
          error={
            count.counted.trim() && count.countedMinor === null
              ? t('common:errors.INVALID_PRICE')
              : undefined
          }
        >
          {(p) => (
            <Input
              {...p}
              className="h-14 text-xl"
              dir="ltr"
              inputMode="decimal"
              value={count.counted}
              onChange={(e) => count.setCounted(e.target.value)}
            />
          )}
        </Field>
      )}
    </>
  );
}

export function useCurrentShift() {
  const api = useApi();
  const { hasPermission } = useAuth();
  return useQuery({
    queryKey: shiftKey,
    queryFn: () => api.shifts.current(),
    enabled: hasPermission('shifts.operate'),
  });
}

/** Selling requires an open shift (BR-027): shows the opening screen until there is one. */
export function RequireShift({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const current = useCurrentShift();
  if (!hasPermission('shifts.operate'))
    return (
      <div className="p-6">
        <Alert tone="warning">{t('shift.noPermission')}</Alert>
      </div>
    );
  if (current.isPending)
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  if (!current.data?.shift) return <OpenShiftPage />;
  return <>{children}</>;
}

/**
 * Opening a shift = counting the drawer (ADR-0090). The drawer keeps its cash between shifts,
 * so the cashier sees the expected balance and confirms what is really there.
 */
export function OpenShiftPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const fmt = useMoney();
  const queryClient = useQueryClient();
  const registers = useQuery({
    queryKey: ['pos', 'registers'],
    queryFn: () => api.shifts.posRegisters(),
  });
  const [registerId, setRegisterId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const count = useCashCount();
  const free = registers.data?.registers.filter((r) => r.availability !== 'occupied') ?? [];
  const selected = registers.data?.registers.find((r) => r.id === registerId);
  // Blind count (BR-162): the cashier is shown no balance and learns the difference afterwards.
  const blind = Boolean(selected?.blindCount || !selected?.expectedCash);
  const expectedMinor = selected?.expectedCash ? minor(selected.expectedCash.amount)! : 0n;
  const difference =
    selected && !blind && count.countedMinor !== null ? count.countedMinor - expectedMinor : null;
  // The drawer's first count sets its balance; later differences need an explanation.
  const needsNote = Boolean(selected && !selected.needsCount && difference && !note.trim());
  const open = useMutation({
    mutationFn: () =>
      api.shifts.open({
        registerId: registerId!,
        ...count.payload(),
        ...(selected?.expectedCash ? { expectedCash: selected.expectedCash.amount } : {}),
        note: note.trim() || null,
      }),
    onSuccess: async (opened) => {
      const diff = opened.openingDiscrepancy;
      if (blind && diff && minor(diff.amount) !== 0n)
        notify.ok(t('shift.openedWithDifference', { amount: fmt(diff) }));
      else notify.ok(t('shift.opened'));
      await queryClient.invalidateQueries({ queryKey: shiftKey });
    },
    onError: async (error) => {
      notify.fail(error);
      // Someone moved cash meanwhile: show the new expected balance to count against.
      await queryClient.invalidateQueries({ queryKey: ['pos', 'registers'] });
    },
  });
  return (
    <div className="mx-auto grid max-w-3xl gap-4 p-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('shift.openTitle')}</h1>
        <p className="text-fg-muted">{t('shift.openSubtitle')}</p>
      </div>
      {registers.data && registers.data.registers.length === 0 ? (
        <Alert tone="warning">{t('shift.noRegisters')}</Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('shift.register')}>
        {registers.data?.registers.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={registerId === r.id}
            disabled={r.availability === 'occupied'}
            onClick={() => setRegisterId(r.id)}
            className="flex min-h-20 flex-col items-start justify-center rounded-lg border-2 border-border bg-surface p-4 text-start aria-checked:border-primary disabled:opacity-50"
          >
            <span className="text-lg font-semibold">{localizedName(r, i18n.language)}</span>
            <span className="text-sm text-fg-muted">
              {r.availability === 'occupied'
                ? t('shift.occupied', { name: r.occupiedBy })
                : r.availability === 'mine'
                  ? t('shift.mine')
                  : t('shift.free')}
            </span>
          </button>
        ))}
      </div>
      {selected ? (
        <div className="grid gap-4 rounded-lg bg-surface p-4">
          {selected.needsCount ? (
            <Alert tone="info">{t('shift.firstCount')}</Alert>
          ) : blind || !selected.expectedCash ? (
            <Alert tone="info">
              <span data-testid="blind-count">{t('shift.blindOpen')}</span>
            </Alert>
          ) : (
            <div className="flex items-baseline justify-between gap-3 text-lg">
              <span>{t('shift.expectedInDrawer')}</span>
              <span dir="ltr" className="font-semibold tabular-nums" data-testid="open-expected">
                {fmt(selected.expectedCash)}
              </span>
            </div>
          )}
          <CashCountFields count={count} />
          {difference !== null && difference !== 0n && !selected.needsCount ? (
            <Alert tone="warning">
              <span data-testid="open-difference">
                {t('shift.openingDifference', { amount: fmt(difference) })}
              </span>
            </Alert>
          ) : null}
          <Field label={t('shift.note')} error={needsNote ? t('shift.noteRequired') : undefined}>
            {(p) => (
              <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            )}
          </Field>
          <Button
            size="lg"
            className="h-14 text-lg"
            disabled={count.countedMinor === null || free.length === 0 || needsNote}
            loading={open.isPending}
            onClick={() => open.mutate()}
          >
            {t('shift.open')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Compact strip above the sale screen: register, opening time and a link to cash management. */
export interface StripAction {
  key: string;
  label: string;
  /** Either a route or a handler. */
  to?: string;
  onSelect?: () => void;
}

/** «Register 1 · Opened 06:32 PM» for the open shift, or null without one. */
export function useShiftSummary(): string | null {
  const { t, i18n } = useTranslation();
  const shift = useCurrentShift().data?.shift;
  if (!shift) return null;
  const since = t('shift.since', {
    time: new Date(shift.openedAt).toLocaleTimeString(i18n.language, {
      hour: '2-digit',
      minute: '2-digit',
      numberingSystem: 'latn',
    }),
  });
  return `${localizedName(shift.registerName, i18n.language)} · ${since}`;
}

function withShiftLink(actions: StripAction[], label: string): StripAction[] {
  return [...actions, { key: 'shift', label, to: '/shift' }];
}

/** Phones: the register's secondary actions behind one «More» button. */
export function ShiftMoreMenu({ actions = [] }: { actions?: StripAction[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Menu
      trigger={
        <Button variant="secondary" className="h-11 shrink-0">
          {t('shift.more')}
        </Button>
      }
    >
      {withShiftLink(actions, t('shift.manage')).map((a) => (
        <MenuItem key={a.key} onSelect={() => (a.to ? void navigate(a.to) : a.onSelect?.())}>
          {a.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

/**
 * Tablets and desktops: the open shift and the register's secondary actions in one row.
 * Phones show the shift in the header and the actions in {@link ShiftMoreMenu}.
 */
export function ShiftStrip({ actions = [] }: { actions?: StripAction[] }) {
  const { t, i18n } = useTranslation();
  const current = useCurrentShift();
  const shift = current.data?.shift;
  if (!shift) return null;
  return (
    <div
      className="hidden flex-wrap items-center gap-3 rounded-lg bg-surface px-4 py-2 text-sm sm:flex"
      data-testid="shift-strip"
    >
      <Badge tone="success">{t('shift.current')}</Badge>
      <span className="font-medium whitespace-nowrap">
        {localizedName(shift.registerName, i18n.language)}
      </span>
      <span className="text-fg-muted whitespace-nowrap">
        {t('shift.since', {
          time: new Date(shift.openedAt).toLocaleTimeString(i18n.language, {
            hour: '2-digit',
            minute: '2-digit',
            numberingSystem: 'latn',
          }),
        })}
      </span>
      <div className="flex-1" />
      {withShiftLink(actions, t('shift.manage')).map((a) =>
        a.to ? (
          <Link
            key={a.key}
            to={a.to}
            className={
              a.key === 'shift'
                ? 'rounded-md bg-primary-soft px-3 py-1.5 font-medium text-primary'
                : 'rounded-md border border-border px-3 py-1.5 font-medium'
            }
          >
            {a.label}
          </Link>
        ) : (
          <Button key={a.key} size="sm" variant="secondary" onClick={a.onSelect}>
            {a.label}
          </Button>
        ),
      )}
    </div>
  );
}

export function ShiftPage() {
  const { t, i18n } = useTranslation();
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const fmt = useMoney();
  const current = useCurrentShift();
  const [movement, setMovement] = useState<'cash_in' | 'cash_out' | null>(null);
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState<Shift | null>(null);

  if (closed)
    return (
      <ClosedResult
        shift={closed}
        onNew={() => {
          setClosed(null);
          void navigate('/');
        }}
      />
    );
  const shift = current.data?.shift;
  if (!shift) return <RequireShift>{null}</RequireShift>;
  const s = shift.summary;
  return (
    <div className="mx-auto grid max-w-4xl gap-4 overflow-y-auto p-4" style={{ maxHeight: '100%' }}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          {t('shift.current')} · {localizedName(shift.registerName, i18n.language)}
        </h1>
        <div className="flex-1" />
        <Link to="/" className="text-primary">
          {t('shift.back')}
        </Link>
      </div>
      {s ? (
        <div className="rounded-lg bg-surface p-4">
          <p className="text-sm text-fg-muted">{t('shift.expected')}</p>
          <p className="text-3xl font-semibold tabular-nums" dir="ltr" data-testid="expected-cash">
            {fmt(s.expectedCash)}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            {(
              [
                ['openingCash', s.openingFloat],
                ['cashIn', s.cashIn],
                ['cashOut', s.cashOut],
                ['cashSales', s.cashSales],
                ['cashRefunds', s.cashRefunds],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-fg-muted">{t(`shift.${k}`)}</dt>
                <dd className="tabular-nums" dir="ltr">
                  {fmt(v)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        // Blind count (BR-162): the drawer figures appear only on the closing result.
        <Alert tone="info">
          <span data-testid="blind-count">{t('shift.blindShift')}</span>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {hasPermission('cash.move') ? (
          <>
            <Button
              size="lg"
              variant="secondary"
              className="h-16 text-lg"
              onClick={() => setMovement('cash_in')}
            >
              {t('shift.recordIn')}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="h-16 text-lg"
              onClick={() => setMovement('cash_out')}
            >
              {t('shift.recordOut')}
            </Button>
          </>
        ) : null}
        <Button
          size="lg"
          variant="danger"
          className="h-16 text-lg"
          onClick={() => setClosing(true)}
        >
          {t('shift.close')}
        </Button>
      </div>
      <section className="rounded-lg bg-surface p-4">
        <h2 className="mb-2 font-semibold">{t('shift.movements')}</h2>
        {shift.movements.length === 0 ? (
          <p className="text-fg-muted">{t('shift.noMovements')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {shift.movements.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
                data-testid={`movement-${m.status}`}
              >
                <span>
                  <span className="font-medium">
                    {m.kind === 'cash_in' ? t('shift.cashIn') : t('shift.cashOut')}
                  </span>
                  <span className="ms-2 text-fg-muted">{t(`shift.reason_${m.reason}`)}</span>
                  {m.note ? <span className="ms-2 text-fg-muted">— {m.note}</span> : null}
                  {m.status !== 'posted' ? (
                    <Badge tone={m.status === 'pending' ? 'warning' : 'neutral'} className="ms-2">
                      {t(`shift.status_${m.status}`)}
                    </Badge>
                  ) : null}
                </span>
                <span className="flex items-center gap-2">
                  {m.status === 'pending' && hasPermission('cash.move') ? (
                    <WithdrawButton movementId={m.id} />
                  ) : null}
                  <span
                    dir="ltr"
                    className={
                      m.status !== 'posted'
                        ? 'tabular-nums text-fg-muted line-through'
                        : m.kind === 'cash_in'
                          ? 'tabular-nums text-success'
                          : 'tabular-nums text-danger'
                    }
                  >
                    {m.kind === 'cash_in' ? '+' : '−'}
                    {fmt(m.amount)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {movement ? <MovementDialog kind={movement} onClose={() => setMovement(null)} /> : null}
      {closing ? (
        <CloseDialog
          shift={shift}
          onClose={() => setClosing(false)}
          onClosed={(result) => {
            setClosing(false);
            setClosed(result);
          }}
        />
      ) : null}
    </div>
  );
}

function WithdrawButton({ movementId }: { movementId: string }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const withdraw = useMutation({
    mutationFn: () => api.shifts.withdrawMovement(movementId),
    onSuccess: (shift) => {
      queryClient.setQueryData(shiftKey, { shift });
      notify.ok(t('shift.withdrawn'));
    },
    onError: notify.fail,
  });
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={withdraw.isPending}
      onClick={() => withdraw.mutate()}
    >
      {t('shift.withdraw')}
    </Button>
  );
}

function MovementDialog({ kind, onClose }: { kind: 'cash_in' | 'cash_out'; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const fmt = useMoney();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  // Bank deposits need their own permission (ADR-0091); hide the reason without it.
  const reasons = (kind === 'cash_in' ? CASH_IN_REASONS : CASH_OUT_REASONS).filter(
    (r) => r !== 'bank_deposit' || hasPermission('cash.deposit'),
  );
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<string>(reasons[0]!);
  const [note, setNote] = useState('');
  const [category, setCategory] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [receipt, setReceipt] = useState('');
  const [corrects, setCorrects] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const current = useCurrentShift();
  // Cash-out limits (BR-164): shown so the cashier knows when a manager must approve.
  const policy = useQuery({
    queryKey: ['pos', 'sales', 'settings'],
    queryFn: () => api.sales.settings(),
  });
  // A correction may only reverse a posted "other" movement (or earlier correction) of this
  // shift that goes the opposite way, up to what is left of it.
  const movements = current.data?.shift?.movements ?? [];
  const correctable = movements
    .filter(
      (m) =>
        m.status === 'posted' &&
        m.kind !== kind &&
        (m.reason === 'other' || m.reason === 'correction'),
    )
    .map((m) => {
      const used = movements
        .filter((c) => c.status === 'posted' && c.correctsMovementId === m.id)
        .reduce((sum, c) => sum + minor(c.amount.amount)!, 0n);
      return { ...m, remaining: minor(m.amount.amount)! - used };
    })
    .filter((m) => m.remaining > 0n);
  const suppliers = useQuery({
    queryKey: ['pos', 'cash', 'suppliers'],
    queryFn: () => api.cash.posSuppliers(),
    enabled: reason === 'supplier_payment',
  });
  const banks = useQuery({
    queryKey: ['pos', 'cash', 'banks'],
    queryFn: () => api.cash.posBankAccounts(),
    enabled: reason === 'bank_deposit',
  });
  const amountMinor = minor(amount);
  const needsNote =
    reason === 'other' ||
    reason === 'correction' ||
    (reason === 'petty_expense' && category === 'other');
  const limitMinor = policy.data ? minor(policy.data.cashOutOtherLimit.amount) : null;
  const aboveLimit =
    kind === 'cash_out' &&
    reason === 'other' &&
    amountMinor !== null &&
    limitMinor !== null &&
    amountMinor > limitMinor;
  const valid =
    amountMinor !== null &&
    amountMinor > 0n &&
    (!needsNote || Boolean(note.trim())) &&
    (reason !== 'correction' || Boolean(corrects)) &&
    (reason !== 'petty_expense' || Boolean(category)) &&
    (reason !== 'supplier_payment' || Boolean(supplierId)) &&
    (reason !== 'bank_deposit' || Boolean(bankAccountId));
  const save = useMutation({
    mutationFn: () =>
      api.shifts.cashMovement({
        kind,
        amount: amount.trim(),
        reason,
        note: note.trim() || null,
        idempotencyKey: key,
        ...(reason === 'petty_expense' ? { category: category as never } : {}),
        ...(reason === 'supplier_payment' ? { supplierId } : {}),
        ...(reason === 'petty_expense' || reason === 'supplier_payment'
          ? { receiptReference: receipt.trim() || null }
          : {}),
        ...(reason === 'bank_deposit' ? { bankAccountId } : {}),
        ...(reason === 'correction' ? { correctsMovementId: corrects } : {}),
      }),
    onSuccess: async (shift) => {
      queryClient.setQueryData(shiftKey, { shift });
      const pending = shift.movements.some((m) => m.status === 'pending');
      notify.ok(t(pending ? 'shift.sentForApproval' : 'shift.recorded'));
      onClose();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={kind === 'cash_in' ? t('shift.recordIn') : t('shift.recordOut')}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t('shift.cancel')}
          </Button>
          <Button
            size="lg"
            disabled={!valid}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('shift.confirm')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label={t('shift.amount')}>
          {(p) => (
            <Input
              {...p}
              className="h-14 text-xl"
              dir="ltr"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('shift.reason')}>
          {(p) => (
            <Select {...p} value={reason} onChange={(e) => setReason(e.target.value)}>
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {t(`shift.reason_${r}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {[
          'float_top_up',
          'safe_drop',
          'change_received',
          'petty_expense',
          'supplier_payment',
          'bank_deposit',
          'correction',
        ].includes(reason) ? (
          <p className="text-sm text-fg-muted" data-testid="movement-hint">
            {t(`shift.movementHint_${reason}`)}
          </p>
        ) : null}
        {kind === 'cash_out' && reason === 'other' && policy.data ? (
          <Alert tone={aboveLimit ? 'warning' : 'info'}>
            <span data-testid="cash-out-limit">
              {t(aboveLimit ? 'shift.aboveLimit' : 'shift.limitHint', {
                amount: fmt(policy.data.cashOutOtherLimit),
              })}
            </span>
          </Alert>
        ) : null}
        {reason === 'correction' ? (
          <Field label={t('shift.corrects')}>
            {(p) => (
              <Select {...p} value={corrects} onChange={(e) => setCorrects(e.target.value)}>
                <option value="">{t('shift.choose')}</option>
                {correctable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {t(`shift.reason_${m.reason}`)} · {fmt(m.remaining)}
                    {m.note ? ` — ${m.note}` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        {reason === 'petty_expense' ? (
          <Field label={t('shift.category')}>
            {(p) => (
              <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">{t('shift.choose')}</option>
                {CASH_EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`shift.category_${c}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        {reason === 'supplier_payment' ? (
          <Field label={t('shift.supplier')}>
            {(p) => (
              <Select {...p} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">{t('shift.choose')}</option>
                {(suppliers.data?.suppliers ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {localizedName(s, i18n.language)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        {reason === 'bank_deposit' ? (
          <Field label={t('shift.bankAccount')}>
            {(p) => (
              <Select
                {...p}
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
              >
                <option value="">{t('shift.choose')}</option>
                {(banks.data?.accounts ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {localizedName(b, i18n.language)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        {reason === 'petty_expense' || reason === 'supplier_payment' ? (
          <Field label={t('shift.receiptReference')}>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                value={receipt}
                onChange={(e) => setReceipt(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        <Field label={needsNote ? t('shift.description') : t('shift.note')}>
          {(p) => (
            <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function CloseDialog({
  shift,
  onClose,
  onClosed,
}: {
  shift: PosShift;
  onClose: () => void;
  onClosed: (s: Shift) => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const fmt = useMoney();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const count = useCashCount();
  const countedMinor = count.countedMinor;
  // Whoever sees the expected figure explains a difference before closing (BR-164).
  const expectedMinor = shift.summary ? minor(shift.summary.expectedCash.amount) : null;
  const difference =
    expectedMinor !== null && countedMinor !== null ? countedMinor - expectedMinor : null;
  const needsNote = difference !== null && difference !== 0n && !note.trim();
  const close = useMutation({
    mutationFn: () =>
      api.shifts.close({
        ...count.payload(),
        note: note.trim() || null,
        version: shift.version,
      }),
    onSuccess: async (result) => {
      notify.ok(t('shift.closed'));
      queryClient.setQueryData(shiftKey, { shift: null });
      await queryClient.invalidateQueries({ queryKey: ['pos', 'registers'] });
      onClosed(result);
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('shift.closeTitle')}
      description={t('shift.closeHint')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t('shift.cancel')}
          </Button>
          <Button
            variant="danger"
            size="lg"
            disabled={countedMinor === null || needsNote}
            loading={close.isPending}
            onClick={() => close.mutate()}
          >
            {t('shift.close')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <CashCountFields count={count} />
        {difference !== null && difference !== 0n ? (
          <Alert tone="warning">
            <span data-testid="close-difference">
              {t('shift.openingDifference', { amount: fmt(difference) })}
            </span>
          </Alert>
        ) : null}
        <Field label={t('shift.note')} error={needsNote ? t('shift.noteRequired') : undefined}>
          {(p) => (
            <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function ClosedResult({ shift, onNew }: { shift: Shift; onNew: () => void }) {
  const { t } = useTranslation();
  const fmt = useMoney();
  const tone =
    shift.outcome === 'balanced' ? 'success' : shift.outcome === 'over' ? 'warning' : 'danger';
  return (
    <div className="mx-auto grid max-w-xl gap-4 p-4" data-testid="close-result">
      <h1 className="text-2xl font-semibold">{t('shift.result')}</h1>
      <dl className="grid gap-3 rounded-lg bg-surface p-4 text-lg">
        <div className="flex justify-between">
          <dt>{t('shift.expected')}</dt>
          <dd dir="ltr" className="tabular-nums">
            {fmt(shift.summary.expectedCash)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>{t('shift.counted')}</dt>
          <dd dir="ltr" className="tabular-nums">
            {shift.countedCash ? fmt(shift.countedCash) : '—'}
          </dd>
        </div>
        <div className="flex justify-between font-semibold">
          <dt>{t('shift.discrepancy')}</dt>
          <dd dir="ltr" className="tabular-nums" data-testid="discrepancy">
            {shift.discrepancy ? fmt(shift.discrepancy) : '—'}
          </dd>
        </div>
      </dl>
      {shift.outcome ? <Badge tone={tone}>{t(`shift.outcome_${shift.outcome}`)}</Badge> : null}
      <Button size="lg" className="h-14" onClick={onNew}>
        {t('shift.newShift')}
      </Button>
    </div>
  );
}
