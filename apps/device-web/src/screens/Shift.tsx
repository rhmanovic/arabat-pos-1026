import {
  type LocalShift,
  type ShiftSummary,
  type StaffMember,
  attemptPin,
  closeShift,
  openShift,
  shiftSummary,
} from '@arabat/device-core';
import { formatDateTime, formatMoney } from '@arabat/i18n';
import { Money } from '@arabat/money';
import { Alert, Button, Dialog, Field, Input } from '@arabat/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError, useDevice } from '../app/device.js';
import { verifyPin } from '../app/pin.js';
import { PinPad } from './Lock.js';
import { StatusBar } from './StatusBar.js';

export const kwd = (minor: bigint, language: string) =>
  formatMoney(Money.ofMinor(minor, 'KWD'), language);

/** An amount as typed (Arabic digits, comma, currency word accepted), or null when unreadable. */
export function parseKwd(value: string): bigint | null {
  try {
    return Money.parseInput(value.trim() === '' ? '0' : value, 'KWD').minor;
  } catch {
    return null;
  }
}

/** Opening count (ADR-0090): the branch shift starts with the cash in the primary's drawer. */
export function OpenShiftScreen() {
  const { t } = useTranslation();
  const { bridge, cashier, reload, requestUpload, role } = useDevice();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const minor = parseKwd(counted);
    if (minor === null || !cashier) return setError(t('errors.INVALID_PRICE'));
    setBusy(true);
    setError(null);
    try {
      await openShift(bridge.db, {
        cashier,
        countedCashMinor: minor,
        note: note.trim() || null,
        role,
      });
      requestUpload();
      await reload();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-dvh flex-col bg-surface-muted">
      <StatusBar />
      <main className="flex flex-1 items-center justify-center p-4">
        <form
          onSubmit={submit}
          className="flex w-full max-w-sm flex-col gap-4 rounded-lg bg-surface p-6 shadow"
        >
          <h1 className="text-xl font-semibold">{t('shift.openTitle')}</h1>
          <p className="text-sm text-fg-muted">{t('shift.openBody')}</p>
          <Field label={t('shift.counted')}>
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                dir="ltr"
                placeholder="0.000"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
                autoFocus
              />
            )}
          </Field>
          <Field label={t('shift.note')}>
            {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Button type="submit" size="lg" loading={busy} disabled={parseKwd(counted) === null}>
            {t('shift.open')}
          </Button>
        </form>
      </main>
    </div>
  );
}

/** A secondary device without an open branch shift: the primary must open it first. */
export function NoBranchShiftScreen() {
  const { t, i18n } = useTranslation();
  const { ctx, syncNow, sync } = useDevice();
  const primary = ctx?.primaryDevice?.name ?? '';
  const last = ctx?.branchShift;
  return (
    <div className="flex h-dvh flex-col bg-surface-muted">
      <StatusBar />
      <main className="flex flex-1 items-center justify-center p-4">
        <div
          className="flex w-full max-w-sm flex-col gap-4 rounded-lg bg-surface p-6 shadow"
          data-testid="no-branch-shift"
        >
          <h1 className="text-xl font-semibold">{t('shift.noBranchShiftTitle')}</h1>
          <p className="text-sm text-fg-muted">
            {primary ? t('shift.noBranchShiftBody', { primary }) : t('shift.noPrimary')}
          </p>
          {last && last.closedAt ? (
            <p className="text-xs text-fg-muted">
              {t('shift.lastBranchShift', {
                name: last.openedBy.fullName,
                at: formatDateTime(last.closedAt, i18n.language),
              })}
            </p>
          ) : null}
          <Button onClick={() => void syncNow()} loading={sync.syncing}>
            {t('status.syncNow')}
          </Button>
        </div>
      </main>
    </div>
  );
}

/**
 * The escape hatch (amendment 3): a manager with `registers.manage` closes an absent cashier's
 * shift at the till with their own PIN, a counted drawer and a note; the server lists it for
 * review.
 */
export function ForceCloseDialog({
  open,
  shift,
  managers,
  onClose,
  onDone,
}: {
  open: boolean;
  shift: LocalShift;
  managers: StaffMember[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { bridge, reload, requestUpload, role } = useDevice();
  const [who, setWho] = useState<StaffMember | null>(null);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const submit = async (pin: string) => {
    if (!who) return;
    const minor = parseKwd(counted);
    if (minor === null) return setError(t('errors.INVALID_PRICE'));
    if (!note.trim()) return setError(t('errors.REASON_REQUIRED'));
    setBusy(true);
    setError(null);
    try {
      const outcome = await attemptPin(bridge.db, who, pin, verifyPin);
      if (!outcome.ok)
        throw new Error(
          outcome.reason === 'locked' ? 'locked' : outcome.reason === 'no_pin' ? 'no_pin' : 'wrong',
        );
      const closed = await closeShift(bridge.db, {
        cashier: who,
        shift,
        countedCashMinor: minor,
        note: note.trim(),
        role,
        forced: true,
      });
      requestUpload();
      await reload();
      setResult(
        `${t('shift.closed', { amount: kwd(closed.discrepancyMinor, i18n.language) })} ${closed.outcome ? t(`shift.${closed.outcome}`) : ''}`,
      );
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(
        m === 'wrong'
          ? t('lock.wrong', { count: '' })
          : m === 'locked'
            ? t('lock.locked', { until: '' })
            : m === 'no_pin'
              ? t('lock.noPin')
              : describeError(e, t),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && (result ? onDone() : onClose())}
      title={t('shift.forceCloseTitle')}
      description={t('shift.forceCloseBody')}
      size="sm"
    >
      {result ? (
        <div className="flex flex-col gap-3">
          <Alert tone="success">{result}</Alert>
          <Button onClick={onDone}>{t('refunds.back')}</Button>
        </div>
      ) : !who ? (
        <div className="grid grid-cols-2 gap-2">
          {managers.map((m) => (
            <Button key={m.membershipId} variant="secondary" size="touch" onClick={() => setWho(m)}>
              <bdi>{m.fullName}</bdi>
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <p className="font-medium">{who.fullName}</p>
          <Field label={t('shift.counted')} className="w-full">
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                dir="ltr"
                placeholder="0.000"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
                data-testid="force-counted"
              />
            )}
          </Field>
          <Field label={t('shift.forceCloseNote')} className="w-full">
            {(p) => (
              <Input
                {...p}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                data-testid="force-note"
              />
            )}
          </Field>
          <PinPad onSubmit={(pin) => void submit(pin)} busy={busy} error={error} />
          <Button variant="ghost" onClick={() => setWho(null)}>
            {t('lock.back')}
          </Button>
        </div>
      )}
    </Dialog>
  );
}

export function SummaryTable({ summary, language }: { summary: ShiftSummary; language: string }) {
  const { t } = useTranslation();
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between gap-3 py-1 ${strong ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span dir="ltr">{value}</span>
    </div>
  );
  return (
    <div className="text-sm" data-testid="shift-summary">
      {row(`${t('shift.sales')} (${summary.salesCount})`, kwd(summary.salesTotalMinor, language))}
      {row(t('shift.discounts'), kwd(summary.discountsMinor, language))}
      {row(
        `${t('shift.refunds')} (${summary.refundsCount})`,
        kwd(summary.refundsTotalMinor, language),
      )}
      <p className="mt-2 font-medium">{t('shift.byMethod')}</p>
      {summary.byMethod.map((m) => (
        <div key={m.methodId} className="flex justify-between gap-3 py-1">
          <span>{language.startsWith('ar') ? m.nameAr || m.nameEn : m.nameEn || m.nameAr}</span>
          <span dir="ltr">{kwd(m.amountMinor, language)}</span>
        </div>
      ))}
      <div className="mt-2 border-t border-border pt-2">
        {row(t('shift.opening'), kwd(summary.openingCashMinor, language))}
        {row(t('shift.cashIn'), kwd(summary.cashInMinor, language))}
        {row(t('shift.cashOut'), kwd(summary.cashOutMinor, language))}
        {row(t('shift.expected'), kwd(summary.expectedCashMinor, language), true)}
      </div>
    </div>
  );
}

/** Closing count and the Z report from the device's own records. */
export function CloseShiftScreen({ onDone }: { onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const { bridge, cashier, shift, reload, requestUpload, role } = useDevice();
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ discrepancyMinor: bigint; outcome: string | null } | null>(
    null,
  );
  useEffect(() => {
    if (shift) void shiftSummary(bridge.db, shift).then(setSummary);
  }, [bridge, shift]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const minor = parseKwd(counted);
    if (minor === null || !cashier || !shift) return setError(t('errors.INVALID_PRICE'));
    setBusy(true);
    setError(null);
    try {
      const closed = await closeShift(bridge.db, {
        cashier,
        shift,
        countedCashMinor: minor,
        note: note.trim() || null,
        role,
      });
      setResult({ discrepancyMinor: closed.discrepancyMinor, outcome: closed.outcome });
      requestUpload();
      await reload();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-dvh flex-col bg-surface-muted">
      <StatusBar />
      <main className="flex flex-1 items-start justify-center overflow-y-auto p-4">
        <div className="grid w-full max-w-3xl gap-4 md:grid-cols-2">
          <section className="rounded-lg bg-surface p-5 shadow">
            <h2 className="mb-2 font-semibold">{t('shift.summary')}</h2>
            {shift ? (
              <p className="mb-3 text-xs text-fg-muted">
                {formatDateTime(shift.openedAt, i18n.language)}
              </p>
            ) : null}
            {summary ? <SummaryTable summary={summary} language={i18n.language} /> : null}
          </section>
          <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg bg-surface p-5 shadow">
            <h1 className="text-xl font-semibold">{t('shift.closeTitle')}</h1>
            {result ? (
              <>
                <Alert tone={result.outcome === 'balanced' ? 'success' : 'warning'}>
                  {t('shift.closed', { amount: kwd(result.discrepancyMinor, i18n.language) })}{' '}
                  {result.outcome ? t(`shift.${result.outcome}`) : ''}
                </Alert>
                <Button onClick={onDone}>{t('refunds.back')}</Button>
              </>
            ) : (
              <>
                <p className="text-sm text-fg-muted">{t('shift.closeBody')}</p>
                <Field label={t('shift.counted')}>
                  {(p) => (
                    <Input
                      {...p}
                      inputMode="decimal"
                      dir="ltr"
                      placeholder="0.000"
                      value={counted}
                      onChange={(e) => setCounted(e.target.value)}
                      autoFocus
                    />
                  )}
                </Field>
                <Field label={t('shift.note')}>
                  {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
                </Field>
                {error ? <Alert tone="danger">{error}</Alert> : null}
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={onDone}>
                    {t('refunds.back')}
                  </Button>
                  <Button
                    type="submit"
                    size="lg"
                    className="flex-1"
                    loading={busy}
                    disabled={parseKwd(counted) === null}
                  >
                    {t('shift.close')}
                  </Button>
                </div>
              </>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}
