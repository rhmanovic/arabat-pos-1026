import { CASH_IN_REASONS, CASH_OUT_REASONS, type Shift } from '@arabat/contracts';
import { formatMoney } from '@arabat/i18n';
import { Money, MoneyError } from '@arabat/money';
import { Alert, Badge, Button, Dialog, Field, Input, Select, Spinner, Textarea } from '@arabat/ui';
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

export function OpenShiftPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const registers = useQuery({
    queryKey: ['pos', 'registers'],
    queryFn: () => api.shifts.posRegisters(),
  });
  const [registerId, setRegisterId] = useState<string | null>(null);
  const [float, setFloat] = useState('');
  const [note, setNote] = useState('');
  const free = registers.data?.registers.filter((r) => r.availability !== 'occupied') ?? [];
  const selected = registers.data?.registers.find((r) => r.id === registerId);
  const open = useMutation({
    mutationFn: () =>
      api.shifts.open({
        registerId: registerId!,
        openingFloat: float.trim(),
        note: note.trim() || null,
      }),
    onSuccess: async () => {
      notify.ok(t('shift.opened'));
      await queryClient.invalidateQueries({ queryKey: shiftKey });
    },
    onError: notify.fail,
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
            onClick={() => {
              setRegisterId(r.id);
              setFloat(r.defaultOpeningFloat.amount);
            }}
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
          <Field
            label={t('shift.openingFloat')}
            error={minor(float) === null && float ? t('common:errors.INVALID_PRICE') : undefined}
          >
            {(p) => (
              <Input
                {...p}
                className="h-14 text-xl"
                dir="ltr"
                inputMode="decimal"
                value={float}
                onChange={(e) => setFloat(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('shift.note')}>
            {(p) => (
              <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            )}
          </Field>
          <Button
            size="lg"
            className="h-14 text-lg"
            disabled={minor(float) === null || free.length === 0}
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
export function ShiftStrip({ extra }: { extra?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const current = useCurrentShift();
  const shift = current.data?.shift;
  if (!shift) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-surface px-3 py-2 text-sm sm:px-4"
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
      <div className="hidden flex-1 sm:block" />
      {/* On phones the actions take their own row and wrap with full-size touch targets. */}
      <div className="flex w-full flex-wrap gap-2 sm:w-auto [&>*]:inline-flex [&>*]:min-h-11 [&>*]:items-center [&>*]:whitespace-nowrap sm:[&>*]:min-h-0">
        {extra}
        <Link
          to="/shift"
          className="rounded-md bg-primary-soft px-3 py-1.5 font-medium text-primary"
        >
          {t('shift.manage')}
        </Link>
      </div>
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
              <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-medium">
                    {m.kind === 'cash_in' ? t('shift.cashIn') : t('shift.cashOut')}
                  </span>
                  <span className="ms-2 text-fg-muted">{t(`shift.reason_${m.reason}`)}</span>
                  {m.note ? <span className="ms-2 text-fg-muted">— {m.note}</span> : null}
                </span>
                <span
                  dir="ltr"
                  className={
                    m.kind === 'cash_in' ? 'tabular-nums text-success' : 'tabular-nums text-danger'
                  }
                >
                  {m.kind === 'cash_in' ? '+' : '−'}
                  {fmt(m.amount)}
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

function MovementDialog({ kind, onClose }: { kind: 'cash_in' | 'cash_out'; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const reasons = kind === 'cash_in' ? CASH_IN_REASONS : CASH_OUT_REASONS;
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<string>(reasons[0]);
  const [note, setNote] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const amountMinor = minor(amount);
  const valid =
    amountMinor !== null && amountMinor > 0n && (reason !== 'other' || Boolean(note.trim()));
  const save = useMutation({
    mutationFn: () =>
      api.shifts.cashMovement({
        kind,
        amount: amount.trim(),
        reason,
        note: note.trim() || null,
        idempotencyKey: key,
      }),
    onSuccess: async (shift) => {
      queryClient.setQueryData(shiftKey, { shift });
      notify.ok(t('shift.recorded'));
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
        <Field label={t('shift.note')}>
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
  shift: Shift;
  onClose: () => void;
  onClosed: (s: Shift) => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const fmt = useMoney();
  const [counted, setCounted] = useState('');
  const [byCount, setByCount] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const breakdownTotal = DENOMINATIONS.reduce((sum, d) => {
    const n = /^\d{1,6}$/.test(counts[d] ?? '') ? BigInt(counts[d]!) : 0n;
    return sum + minor(d)! * n;
  }, 0n);
  const countedMinor = byCount ? breakdownTotal : minor(counted);
  const close = useMutation({
    mutationFn: () =>
      api.shifts.close({
        countedCash: Money.ofMinor(countedMinor!, 'KWD').toDecimalString(),
        ...(byCount
          ? {
              breakdown: DENOMINATIONS.map((value) => ({
                value,
                count: /^\d{1,6}$/.test(counts[value] ?? '') ? Number(counts[value]) : 0,
              })),
            }
          : {}),
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
            disabled={countedMinor === null}
            loading={close.isPending}
            onClick={() => close.mutate()}
          >
            {t('shift.close')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={byCount}
            onChange={(e) => setByCount(e.target.checked)}
          />
          {t('shift.countNotes')}
        </label>
        {byCount ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {DENOMINATIONS.map((d) => (
              <Field key={d} label={d.replace(/\.?0+$/, '')}>
                {(p) => (
                  <Input
                    {...p}
                    dir="ltr"
                    inputMode="numeric"
                    value={counts[d] ?? ''}
                    onChange={(e) => setCounts((c) => ({ ...c, [d]: e.target.value }))}
                  />
                )}
              </Field>
            ))}
            <p className="col-span-full text-lg font-semibold" dir="ltr" data-testid="count-total">
              {t('shift.total')}: {fmt(breakdownTotal)}
            </p>
          </div>
        ) : (
          <Field label={t('shift.counted')}>
            {(p) => (
              <Input
                {...p}
                className="h-14 text-xl"
                dir="ltr"
                inputMode="decimal"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
              />
            )}
          </Field>
        )}
        <Field label={t('shift.note')}>
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
