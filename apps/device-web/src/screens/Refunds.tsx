import {
  type RefundReason,
  type RefundableSale,
  type StaffMember,
  attemptPin,
  commitRefund,
  listSales,
  prepareRefund,
  refundableSale,
} from '@arabat/device-core';
import { formatDateTime } from '@arabat/i18n';
import { formatQuantity } from '@arabat/money';
import { Alert, Button, Checkbox, Dialog, Field, Input, Select, useToast } from '@arabat/ui';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError, useDevice } from '../app/device.js';
import { verifyPin } from '../app/pin.js';
import { PinPad } from './Lock.js';
import { kwd } from './Shift.js';
import { StatusBar } from './StatusBar.js';

const REASONS: RefundReason[] = [
  'changed_mind',
  'defective',
  'wrong_item',
  'damaged',
  'price_adjustment',
  'other',
];

/** Refunds of this device's own sales (owner decision 4), approved at the till when needed. */
export function RefundsScreen({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const { bridge, cashier, ctx, shift, staff, reload, requestUpload } = useDevice();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [sales, setSales] = useState<Awaited<ReturnType<typeof listSales>>>([]);
  const [picked, setPicked] = useState<RefundableSale | null>(null);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [restock, setRestock] = useState<Record<number, boolean>>({});
  const [reason, setReason] = useState<RefundReason>('changed_mind');
  const [note, setNote] = useState('');
  const [approver, setApprover] = useState<StaffMember | null>(null);
  const [approving, setApproving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listSales(bridge.db, { search: search.trim() || undefined, limit: 40 }).then(setSales);
  }, [bridge, search, picked]);

  const lines = useMemo(
    () =>
      Object.entries(quantities)
        .filter(([, q]) => q.trim() && q.trim() !== '0')
        .map(([pos, q]) => ({
          position: Number(pos),
          quantity: q.trim(),
          ...(restock[Number(pos)] === undefined ? {} : { restock: restock[Number(pos)] }),
        })),
    [quantities, restock],
  );
  const preview = useMemo(() => {
    if (!picked || !cashier || !shift || !ctx || lines.length === 0) return null;
    try {
      return {
        ok: true as const,
        value: prepareRefund(
          {
            refundable: picked,
            lines,
            reason,
            note: note.trim() || null,
            payback: null,
            cashier,
            shift,
            approver,
          },
          ctx,
        ),
      };
    } catch (e) {
      return { ok: false as const, error: e };
    }
  }, [picked, cashier, shift, ctx, lines, reason, note, approver]);
  const needsApprover =
    preview &&
    !preview.ok &&
    preview.error instanceof Error &&
    /second person|APPROVAL/.test(preview.error.message);

  const pick = async (saleId: string) => {
    const r = await refundableSale(bridge.db, saleId);
    setPicked(r);
    setQuantities({});
    setRestock({});
    setApprover(null);
    setError(null);
  };
  const submit = async () => {
    if (!preview?.ok || !picked || !shift) return;
    setBusy(true);
    setError(null);
    try {
      const done = await commitRefund(bridge.db, preview.value, {
        refundable: picked,
        shift,
        approver,
      });
      requestUpload();
      toast.success(t('refunds.done', { number: done.refundNumber }));
      await reload();
      setPicked(null);
    } catch (e) {
      setError(describeError(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-surface-muted">
      <StatusBar />
      <main className="grid min-h-0 flex-1 gap-2 p-2 md:grid-cols-[minmax(16rem,22rem)_1fr]">
        <section className="flex min-h-0 flex-col rounded-lg bg-surface p-3">
          <div className="mb-2 flex items-center justify-between">
            <h1 className="font-semibold">{t('refunds.title')}</h1>
            <Button variant="ghost" size="sm" onClick={onBack}>
              {t('refunds.back')}
            </Button>
          </div>
          <Input
            dir="ltr"
            placeholder={t('refunds.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="refund-search"
          />
          <ul className="mt-2 min-h-0 flex-1 divide-y divide-border overflow-y-auto text-sm">
            {sales.length === 0 ? (
              <li className="py-3 text-fg-muted">{t('refunds.none')}</li>
            ) : null}
            {sales.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 py-2 text-start hover:bg-surface-muted"
                  onClick={() => void pick(s.id)}
                >
                  <span>
                    <span dir="ltr" className="block font-medium">
                      {s.receiptNumber}
                    </span>
                    <span className="text-xs text-fg-muted">
                      {formatDateTime(s.occurredAt, i18n.language)}
                    </span>
                  </span>
                  <span dir="ltr">
                    {kwd(s.totalMinor, i18n.language)}
                    {s.refundedMinor > 0n ? (
                      <span className="block text-xs text-fg-muted">
                        {t('refunds.refunded', { amount: kwd(s.refundedMinor, i18n.language) })}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="min-h-0 overflow-y-auto rounded-lg bg-surface p-3">
          {!picked ? (
            <p className="text-sm text-fg-muted">{t('refunds.pick')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <h2 className="font-semibold" dir="ltr">
                {picked.sale.receiptNumber}
              </h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-start text-fg-muted">
                    <th className="py-1 text-start">{t('refunds.lines')}</th>
                    <th className="py-1 text-start">{t('refunds.quantity')}</th>
                    <th className="py-1 text-start">{t('refunds.restock')}</th>
                  </tr>
                </thead>
                <tbody>
                  {picked.lines.map((l) => {
                    const left = l.soldMilli - l.refundedMilli;
                    return (
                      <tr key={l.position} className="border-t border-border">
                        <td className="py-2">
                          <span dir="auto">
                            {i18n.language.startsWith('ar')
                              ? l.name.nameAr || l.name.nameEn
                              : l.name.nameEn || l.name.nameAr}
                          </span>
                          <span className="block text-xs text-fg-muted" dir="ltr">
                            {formatQuantity(left)} × {kwd(l.netMinor, i18n.language)}
                          </span>
                        </td>
                        <td className="py-2">
                          <Input
                            inputMode="decimal"
                            dir="ltr"
                            className="w-24"
                            aria-label={`${t('refunds.quantity')} ${l.position}`}
                            placeholder="0"
                            disabled={left <= 0n}
                            value={quantities[l.position] ?? ''}
                            onChange={(e) =>
                              setQuantities({ ...quantities, [l.position]: e.target.value })
                            }
                          />
                        </td>
                        <td className="py-2">
                          {l.trackInventory ? (
                            <Checkbox
                              label={<span className="sr-only">{t('refunds.restock')}</span>}
                              checked={
                                restock[l.position] ??
                                !(reason === 'damaged' || reason === 'defective')
                              }
                              onChange={(e) =>
                                setRestock({ ...restock, [l.position]: e.target.checked })
                              }
                            />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('refunds.reason')}>
                  {(p) => (
                    <Select
                      {...p}
                      value={reason}
                      onChange={(e) => setReason(e.target.value as RefundReason)}
                    >
                      {REASONS.map((r) => (
                        <option key={r} value={r}>
                          {t(`refunds.reasons.${r}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={t('shift.note')}>
                  {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
                </Field>
              </div>
              {preview?.ok ? (
                <div className="rounded-md border border-border p-3 text-sm">
                  <div className="flex justify-between font-semibold">
                    <span>{t('refunds.total')}</span>
                    <span dir="ltr" data-testid="refund-total">
                      {kwd(preview.value.totalMinor, i18n.language)}
                    </span>
                  </div>
                  <p className="mt-1 text-fg-muted">{t('refunds.payback')}:</p>
                  {preview.value.payback.map((p) => (
                    <div key={p.paymentId} className="flex justify-between">
                      <span>{p.kind}</span>
                      <span dir="ltr">{kwd(p.amountMinor, i18n.language)}</span>
                    </div>
                  ))}
                  {approver ? (
                    <p className="mt-1 text-success">
                      {t('refunds.approver')}: {approver.fullName}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {preview && !preview.ok ? (
                <Alert tone={needsApprover ? 'warning' : 'danger'}>
                  {describeError(preview.error, t)}
                  {needsApprover ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-2"
                      onClick={() => setApproving(true)}
                    >
                      {t('refunds.approver')}
                    </Button>
                  ) : null}
                </Alert>
              ) : null}
              {error ? <Alert tone="danger">{error}</Alert> : null}
              <Button
                size="lg"
                loading={busy}
                disabled={!preview?.ok}
                onClick={() => void submit()}
                data-testid="refund-submit"
              >
                {t('refunds.submit')}
              </Button>
            </div>
          )}
        </section>
      </main>
      <ApproverDialog
        open={approving}
        candidates={staff.filter(
          (s) =>
            s.membershipId !== cashier?.membershipId &&
            s.pinHash &&
            s.permissions.includes('refunds.approve'),
        )}
        onClose={() => setApproving(false)}
        onApproved={(m) => {
          setApprover(m);
          setApproving(false);
        }}
      />
    </div>
  );
}

function ApproverDialog({
  open,
  candidates,
  onClose,
  onApproved,
}: {
  open: boolean;
  candidates: StaffMember[];
  onClose: () => void;
  onApproved: (member: StaffMember) => void;
}) {
  const { t } = useTranslation();
  const { bridge } = useDevice();
  const [who, setWho] = useState<StaffMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (pin: string) => {
    if (!who) return;
    setBusy(true);
    const outcome = await attemptPin(bridge.db, who, pin, verifyPin);
    setBusy(false);
    if (outcome.ok) {
      onApproved(who);
      setWho(null);
      setError(null);
    } else
      setError(
        outcome.reason === 'wrong'
          ? t('lock.wrong', { count: outcome.failuresLeft })
          : outcome.reason,
      );
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('refunds.approver')}
      size="sm"
    >
      {!who ? (
        <div className="grid grid-cols-2 gap-2">
          {candidates.map((s) => (
            <Button key={s.membershipId} variant="secondary" size="touch" onClick={() => setWho(s)}>
              <bdi>{s.fullName}</bdi>
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <p className="font-medium">{who.fullName}</p>
          <PinPad onSubmit={(pin) => void submit(pin)} busy={busy} error={error} />
          <Button variant="ghost" onClick={() => setWho(null)}>
            {t('lock.back')}
          </Button>
        </div>
      )}
    </Dialog>
  );
}
