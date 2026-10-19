import { type StaffMember, attemptPin } from '@arabat/device-core';
import { Alert, Button, cn } from '@arabat/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDevice } from '../app/device.js';
import { verifyPin } from '../app/pin.js';
import { LanguageButton, SyncLine } from './StatusBar.js';

/** A numeric keypad for PINs (6–12 digits); the digits are never shown. */
export function PinPad({
  onSubmit,
  busy,
  label,
  error,
  autoSubmitAt,
}: {
  onSubmit: (pin: string) => void;
  busy: boolean;
  label?: string;
  error?: string | null;
  autoSubmitAt?: number;
}) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const press = (d: string) => {
    if (busy || pin.length >= 12) return;
    const next = pin + d;
    setPin(next);
    if (autoSubmitAt && next.length === autoSubmitAt) {
      onSubmit(next);
      setPin('');
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter' && pin.length >= 6) {
        onSubmit(pin);
        setPin('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `press` closes over pin
  }, [pin, busy]);
  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-3" data-testid="pin-pad">
      {label ? <p className="text-sm text-fg-muted">{label}</p> : null}
      <div className="flex h-8 items-center gap-2" aria-label={t('lock.pin')} aria-live="polite">
        {Array.from({ length: Math.max(6, pin.length) }).map((_, i) => (
          <span
            key={i}
            className={cn('size-3 rounded-full border border-fg', i < pin.length && 'bg-fg')}
          />
        ))}
      </div>
      {error ? (
        <Alert tone="danger" className="w-full py-2">
          {error}
        </Alert>
      ) : null}
      <div className="grid w-full grid-cols-3 gap-2" dir="ltr">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Button
            key={d}
            type="button"
            variant="secondary"
            size="touch"
            className="text-2xl"
            onClick={() => press(d)}
            disabled={busy}
          >
            {d}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="touch"
          onClick={() => setPin('')}
          disabled={busy}
        >
          {t('lock.clear')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="touch"
          className="text-2xl"
          onClick={() => press('0')}
          disabled={busy}
        >
          0
        </Button>
        <Button
          type="button"
          size="touch"
          loading={busy}
          disabled={pin.length < 6}
          onClick={() => {
            onSubmit(pin);
            setPin('');
          }}
        >
          {t('lock.enter')}
        </Button>
      </div>
    </div>
  );
}

/** Cashier picker and PIN pad: the till is locked until someone signs in locally (ADR-0112 §3). */
export function LockScreen() {
  const { t, i18n } = useTranslation();
  const { bridge, staff, ctx, signIn, sync, canSell, setRegistered, offline } = useDevice();
  const [who, setWho] = useState<StaffMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offlineHours = offline.hoursSinceSync === null ? null : Math.floor(offline.hoursSinceSync);

  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Owner decision 6: the cashier chooses their own PIN through a link to their e-mail.
  const requestPinLink = async () => {
    if (!who) return;
    setSending(true);
    setError(null);
    try {
      const res = await bridge.api.request('POST', '/device/pin-reset', {
        membershipId: who.membershipId,
      });
      setNotice(t(res.status === 429 ? 'lock.resetPinWait' : 'lock.resetPinSent'));
    } catch (e) {
      const code = e instanceof Error ? e.message.split(':')[0] : '';
      setError(code === 'NETWORK' ? t('lock.resetPinOffline') : t('errors.unknown'));
    } finally {
      setSending(false);
    }
  };

  const submit = async (pin: string) => {
    if (!who) return;
    setBusy(true);
    setError(null);
    const outcome = await attemptPin(bridge.db, who, pin, verifyPin);
    setBusy(false);
    if (outcome.ok) {
      signIn(who);
      return;
    }
    if (outcome.reason === 'no_pin') setError(t('lock.noPin'));
    else if (outcome.reason === 'locked')
      setError(
        t('lock.locked', {
          until: outcome.until.toLocaleTimeString(i18n.language, {
            hour: '2-digit',
            minute: '2-digit',
            numberingSystem: 'latn',
          }),
        }),
      );
    else setError(t('lock.wrong', { count: outcome.failuresLeft }));
  };

  return (
    <main className="flex min-h-dvh flex-col bg-console text-console-fg">
      <header className="flex items-center gap-3 px-4 py-3">
        <span className="font-semibold">{t('title')}</span>
        <span className="text-sm text-console-fg/70" dir="auto">
          {ctx
            ? `${i18n.language.startsWith('ar') ? ctx.merchant.nameAr || ctx.merchant.nameEn : ctx.merchant.nameEn || ctx.merchant.nameAr} · ${ctx.branch.code}-${ctx.register.code}`
            : ''}
        </span>
        <div className="flex-1" />
        <SyncLine />
        <LanguageButton />
      </header>
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-lg bg-surface p-6 text-fg shadow-xl">
          {sync.revoked ? (
            <div className="flex flex-col gap-3">
              <Alert tone="danger">{t('lock.revoked')}</Alert>
              <Button onClick={() => setRegistered(false)}>{t('lock.registerAgain')}</Button>
            </div>
          ) : sync.suspended ? (
            <Alert tone="danger">{t('lock.suspended')}</Alert>
          ) : !canSell ? (
            <Alert tone="danger">
              {t('lock.stopped', {
                hours: offlineHours ?? '—',
                limit: ctx?.offlineLimitHours ?? 72,
              })}
            </Alert>
          ) : null}
          <h1 className="mt-2 text-xl font-semibold">{who ? who.fullName : t('lock.title')}</h1>
          {!who ? (
            staff.length === 0 ? (
              <p className="mt-3 text-sm text-fg-muted">{t('lock.noStaff')}</p>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {staff.map((s) => (
                  <Button
                    key={s.membershipId}
                    variant="secondary"
                    size="touch"
                    disabled={!canSell}
                    onClick={() => setWho(s)}
                    className="h-auto min-h-touch py-3"
                  >
                    <bdi>{s.fullName}</bdi>
                  </Button>
                ))}
              </div>
            )
          ) : (
            <div className="mt-4 flex flex-col items-center gap-3">
              {notice ? (
                <Alert tone="success" className="w-full py-2">
                  {notice}
                </Alert>
              ) : null}
              <PinPad onSubmit={(pin) => void submit(pin)} busy={busy} error={error} />
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setWho(null);
                    setError(null);
                    setNotice(null);
                  }}
                >
                  {t('lock.back')}
                </Button>
                <Button
                  variant="secondary"
                  loading={sending}
                  onClick={() => void requestPinLink()}
                  data-testid="reset-pin"
                >
                  {t('lock.resetPin')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
