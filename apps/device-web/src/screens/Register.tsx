import type { DeviceRole, RegisterDeviceResult } from '@arabat/contracts';
import { Alert, Button, Field, Input } from '@arabat/ui';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError, useDevice } from '../app/device.js';
import { LanguageButton } from './StatusBar.js';

/**
 * One-time registration by a manager (DEVICE_API.md §2): credentials, then company / branch,
 * then the device's role (primary with the cash drawer, or additional).
 */
export function RegisterScreen() {
  const { t, i18n } = useTranslation();
  const { bridge, setRegistered, syncNow, sync } = useDevice();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [choices, setChoices] = useState<Extract<
    RegisterDeviceResult,
    { status: 'select_branch' }
  > | null>(null);
  const [roleStep, setRoleStep] = useState<Extract<
    RegisterDeviceResult,
    { status: 'select_role' }
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const name = (x: { nameEn: string | null; nameAr: string | null }) =>
    (i18n.language.startsWith('ar') ? x.nameAr || x.nameEn : x.nameEn || x.nameAr) ?? '';

  const register = async (merchantId?: string, branchId?: string, role?: DeviceRole) => {
    setBusy(true);
    setError(null);
    try {
      const res = await bridge.api.register({
        email: email.trim(),
        password,
        deviceName: deviceName.trim(),
        ...(merchantId ? { merchantId, branchId } : {}),
        ...(role ? { role } : {}),
      });
      if (res.status !== 200) {
        const body = res.body as { code?: string; detail?: string } | null;
        setError(
          t(`common:errors.${body?.code ?? 'unknown'}`, {
            defaultValue: body?.detail ?? t('errors.unknown'),
          }),
        );
        return;
      }
      const body = res.body as RegisterDeviceResult;
      if (body.status === 'select_branch') {
        setChoices(body);
        return;
      }
      if (body.status === 'select_role') {
        setRoleStep(body);
        return;
      }
      setDone(
        t('register.done', { branch: body.device.branchCode, register: body.device.registerCode }),
      );
      setRegistered(true);
      await syncNow();
    } catch (e) {
      setError(describeError(e, t));
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void register();
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-console p-4">
      <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{t('register.title')}</h1>
            <p className="mt-1 text-sm text-fg-muted">{t('register.body')}</p>
          </div>
          <LanguageButton />
        </div>
        {sync.online === false ? <Alert tone="warning">{t('register.offline')}</Alert> : null}
        {done ? <Alert tone="success">{done}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {roleStep ? (
          <div className="mt-4 flex flex-col gap-3">
            <p className="font-medium">
              {t('register.chooseRole', { branch: name(roleStep.branch) || roleStep.branch.code })}
            </p>
            <Button
              size="touch"
              disabled={busy || roleStep.primaryTaken}
              onClick={() => void register(roleStep.merchantId, roleStep.branch.id, 'primary')}
              className="flex-col items-start"
            >
              <span>{t('register.primary')}</span>
              <span className="text-sm font-normal opacity-80">
                {roleStep.primaryTaken ? t('register.primaryTaken') : t('register.primaryHint')}
              </span>
            </Button>
            <Button
              variant="secondary"
              size="touch"
              disabled={busy}
              onClick={() => void register(roleStep.merchantId, roleStep.branch.id, 'secondary')}
              className="flex-col items-start"
            >
              <span>{t('register.secondary')}</span>
              <span className="text-sm font-normal text-fg-muted">
                {t('register.secondaryHint')}
              </span>
            </Button>
            <Button variant="ghost" onClick={() => setRoleStep(null)}>
              {t('register.back')}
            </Button>
          </div>
        ) : choices ? (
          <div className="mt-4 flex flex-col gap-3">
            <p className="font-medium">{t('register.chooseBranch')}</p>
            {choices.merchants.map((m) => (
              <div key={m.id} className="rounded-md border border-border p-3">
                <p className="mb-2 font-semibold">
                  <bdi>{name(m)}</bdi>
                </p>
                <div className="flex flex-col gap-2">
                  {m.branches.map((b) => (
                    <Button
                      key={b.id}
                      variant="secondary"
                      size="touch"
                      disabled={busy}
                      onClick={() => void register(m.id, b.id)}
                      className="justify-between"
                    >
                      <bdi>{name(b)}</bdi>
                      <span dir="ltr" className="text-fg-muted">
                        {b.code}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            ))}
            <Button variant="ghost" onClick={() => setChoices(null)}>
              {t('register.back')}
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
            <Field label={t('register.email')}>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  autoComplete="username"
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label={t('register.password')}>
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label={t('register.deviceName')}>
              {(p) => (
                <Input
                  {...p}
                  value={deviceName}
                  placeholder={t('register.deviceNamePlaceholder')}
                  maxLength={80}
                  onChange={(e) => setDeviceName(e.target.value)}
                  required
                />
              )}
            </Field>
            <Button
              type="submit"
              size="lg"
              loading={busy}
              disabled={!email || !password || !deviceName.trim()}
            >
              {t('register.submit')}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
