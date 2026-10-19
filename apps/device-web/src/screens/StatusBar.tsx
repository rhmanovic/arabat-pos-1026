import { type OutboxEntry, listOutbox, offlineState } from '@arabat/device-core';
import { formatDateTime } from '@arabat/i18n';
import { Alert, Badge, Button, Dialog, cn } from '@arabat/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDevice } from '../app/device.js';

export function LanguageButton() {
  const { i18n } = useTranslation();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void i18n.changeLanguage(i18n.resolvedLanguage === 'en' ? 'ar' : 'en')}
    >
      {i18n.resolvedLanguage === 'en' ? 'العربية' : 'English'}
    </Button>
  );
}

/** The one-line sync state: synced / N waiting / N not accepted / offline. */
export function SyncLine({ onOpenRefused }: { onOpenRefused?: () => void }) {
  const { t, i18n } = useTranslation();
  const { sync, syncNow } = useDevice();
  const when = sync.lastSuccessfulSyncAt
    ? formatDateTime(sync.lastSuccessfulSyncAt, i18n.language)
    : t('status.never');
  return (
    <span className="flex items-center gap-2 text-sm" data-testid="sync-line">
      {sync.syncing ? (
        <Badge tone="primary">{t('status.syncing')}</Badge>
      ) : sync.online === false ? (
        <Badge tone="warning">{t('status.offline')}</Badge>
      ) : sync.pending > 0 ? (
        <Badge tone="warning">{t('status.waiting', { count: sync.pending })}</Badge>
      ) : (
        <Badge tone="success">{t('status.synced')}</Badge>
      )}
      {sync.refused > 0 ? (
        <button type="button" className="inline-flex" onClick={onOpenRefused}>
          <Badge tone="danger">{t('status.refused', { count: sync.refused })}</Badge>
        </button>
      ) : null}
      <span className="hidden text-xs opacity-70 md:inline" title={t('status.lastSync', { when })}>
        {t('status.lastSync', { when })}
      </span>
      <Button variant="ghost" size="sm" onClick={() => void syncNow()} disabled={sync.syncing}>
        {t('status.syncNow')}
      </Button>
    </span>
  );
}

/** The records the server refused, kept on the device for the cashier and the manager. */
export function RefusedDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const { bridge, sync } = useDevice();
  const [items, setItems] = useState<OutboxEntry[]>([]);
  useEffect(() => {
    if (open) void listOutbox(bridge.db, 'refused').then(setItems);
  }, [open, bridge, sync.refused]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('status.refusedTitle')}
      description={t('status.refusedHint')}
    >
      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('status.refusedEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {items.map((e) => {
            const body = JSON.parse(e.body) as { receiptNumber?: string; occurredAt: string };
            return (
              <li key={e.id} className="flex flex-col gap-1 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {t(`refunds.record.${e.kind}`, { defaultValue: e.kind })}{' '}
                    {body.receiptNumber ? <span dir="ltr">{body.receiptNumber}</span> : null}
                  </span>
                  <span className="text-xs text-fg-muted">
                    {formatDateTime(body.occurredAt, i18n.language)}
                  </span>
                </div>
                <span className="text-danger">
                  {e.code}: {e.message}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}

/** Always-visible top strip: sync, offline warning, printer, version, update, lock. */
export function StatusBar({ title }: { title?: string }) {
  const { t, i18n } = useTranslation();
  const {
    ctx,
    info,
    printer,
    updateReady,
    applyUpdate,
    cart,
    lock,
    logOut,
    canLogOut,
    cashier,
    shift,
    staff,
    role,
  } = useDevice();
  const [refusedOpen, setRefusedOpen] = useState(false);
  const offline = offlineState(ctx?.lastSuccessfulSyncAt ?? null, ctx?.offlineLimitHours ?? 72);
  const hours = offline.hoursSinceSync === null ? '—' : Math.floor(offline.hoursSinceSync);
  const shiftOwner = shift
    ? staff.find((s) => s.membershipId === shift.membershipId)?.fullName
    : null;
  return (
    <>
      <header className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 bg-console px-3 py-1.5 text-console-fg">
        <span className="font-semibold">{title ?? t('title')}</span>
        {ctx ? (
          <span className="text-sm text-console-fg/70" dir="ltr">
            {ctx.branch.code}-{ctx.register.code}
          </span>
        ) : null}
        {shiftOwner ? (
          <span className="hidden text-sm text-console-fg/80 sm:inline" data-testid="shift-owner">
            <span className="me-1.5 inline-block size-2 rounded-full bg-success" aria-hidden />
            {role === 'secondary' ? t('status.branchShiftOf', { name: shiftOwner }) : shiftOwner}
          </span>
        ) : null}
        <div className="flex-1" />
        <SyncLine onOpenRefused={() => setRefusedOpen(true)} />
        <span
          className={cn(
            'hidden items-center gap-1 text-xs lg:inline-flex',
            printer?.ready ? 'text-console-fg/80' : 'text-warning',
          )}
          data-testid="printer-state"
        >
          <span
            className={cn(
              'inline-block size-2 rounded-full',
              printer?.ready ? 'bg-success' : 'bg-warning',
            )}
            aria-hidden
          />
          {printer?.ready
            ? t('status.printerReady', { name: printer.name ?? '' })
            : t('status.printerMissing')}
        </span>
        {info ? (
          <span className="hidden text-xs text-console-fg/60 xl:inline" dir="ltr">
            {t('status.version', { app: info.appVersion, bundle: info.bundleVersion })}
          </span>
        ) : null}
        {cashier ? (
          <>
            <span className="hidden max-w-32 truncate text-sm sm:inline">
              <bdi>{cashier.fullName}</bdi>
            </span>
            <Button variant="secondary" size="sm" onClick={lock} data-testid="lock">
              {t('status.lockNow')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={logOut}
              disabled={!canLogOut}
              title={canLogOut ? undefined : t('lock.logOutBlocked')}
              data-testid="log-out"
            >
              {t('lock.logOut')}
            </Button>
          </>
        ) : null}
        <LanguageButton />
      </header>
      {offline.level === 'yellow' || offline.level === 'red' ? (
        <Alert
          tone={offline.level === 'red' ? 'danger' : 'warning'}
          className="rounded-none border-x-0 py-2"
        >
          {t(`status.${offline.level}`, { hours, limit: offline.limitHours })}
        </Alert>
      ) : null}
      {updateReady ? (
        <div className="flex items-center justify-between gap-3 bg-primary-soft px-3 py-2 text-sm">
          <span>{t('status.updateReady')}</span>
          <Button size="sm" onClick={() => void applyUpdate()} disabled={cart.lines.length > 0}>
            {t('status.updateApply')}
          </Button>
        </div>
      ) : null}
      <RefusedDialog open={refusedOpen} onOpenChange={setRefusedOpen} />
      <span className="sr-only">{i18n.language}</span>
    </>
  );
}
