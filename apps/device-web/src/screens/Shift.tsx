import { type ShiftSummary, closeShift, openShift, shiftSummary } from '@arabat/device-core';
import { formatDateTime, formatMoney } from '@arabat/i18n';
import { Money } from '@arabat/money';
import { Alert, Button, Field, Input } from '@arabat/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError, useDevice } from '../app/device.js';
import { StatusBar } from './StatusBar.js';

export const kwd = (minor: bigint, language: string) =>
  formatMoney(Money.ofMinor(minor, 'KWD'), language);

function parseKwd(value: string): bigint | null {
  try {
    return Money.parse(value.trim() === '' ? '0' : value.trim(), 'KWD').minor;
  } catch {
    return null;
  }
}

/** Opening count (ADR-0090): the shift starts with the cash in the drawer. */
export function OpenShiftScreen() {
  const { t } = useTranslation();
  const { bridge, cashier, reload, requestUpload, shift, staff } = useDevice();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const other =
    shift && cashier && shift.membershipId !== cashier.membershipId
      ? staff.find((s) => s.membershipId === shift.membershipId)
      : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const minor = parseKwd(counted);
    if (minor === null || !cashier) return setError(t('errors.INVALID_PRICE'));
    setBusy(true);
    setError(null);
    try {
      await openShift(bridge.db, { cashier, countedCashMinor: minor, note: note.trim() || null });
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
          {other ? (
            <Alert tone="warning">{t('shift.anotherPerson', { name: other.fullName })}</Alert>
          ) : (
            <>
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
            </>
          )}
        </form>
      </main>
    </div>
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
  const { bridge, cashier, shift, reload, requestUpload } = useDevice();
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
