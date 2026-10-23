import type { StoreAddresses, StoreDomain } from '@arabat/contracts';
import { Alert, Badge, Button, Field, Input, Section, cn } from '@arabat/ui';
import { ErrorState, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

/*
 * The store's addresses and its own domain (ADR-0136, ADR-0137). The merchant buys a domain
 * anywhere, types it here and adds one record at their provider; the platform does the rest
 * (checks, certificate, main address) and shows where it stands.
 */

const KEY = ['online', 'domain'];

export function DomainTab() {
  const { t } = useTranslation();
  const api = useApi();
  const addresses = useQuery({
    queryKey: KEY,
    queryFn: () => api.online.domain(),
    // While the records or the certificate are on their way, the status follows by itself.
    refetchInterval: (q) =>
      q.state.data?.domain && ['pending', 'verifying'].includes(q.state.data.domain.status)
        ? 30_000
        : false,
  });
  if (addresses.isPending) return null;
  if (addresses.isError)
    return <ErrorState error={addresses.error} onRetry={() => void addresses.refetch()} />;
  const a = addresses.data;
  return (
    <div className="flex flex-col gap-4" data-testid="domain-tab">
      <Section title={t('domain.addressesTitle')} description={t('domain.addressesHint')}>
        <ul className="flex flex-col divide-y divide-border">
          <AddressRow
            label={t('domain.mainAddress')}
            hint={t('domain.mainAddressHint')}
            url={a.primaryUrl}
            badge={t('domain.main')}
            testId="address-main"
          />
          {a.primaryUrl !== a.storeUrl ? (
            <AddressRow
              label={t('domain.storeAddress')}
              hint={t('domain.storeAddressHint')}
              url={a.storeUrl}
              testId="address-store"
            />
          ) : null}
          {a.permanentUrl ? (
            <AddressRow
              label={t('domain.permanentAddress')}
              hint={t('domain.permanentAddressHint')}
              url={a.permanentUrl}
              testId="address-permanent"
            />
          ) : null}
        </ul>
      </Section>
      <OwnDomain addresses={a} />
    </div>
  );
}

function AddressRow({
  label,
  hint,
  url,
  badge,
  testId,
}: {
  label: string;
  hint: string;
  url: string;
  badge?: string;
  testId: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3" data-testid={testId}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-semibold">
          {label}
          {badge ? <Badge tone="success">{badge}</Badge> : null}
        </span>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          dir="ltr"
          className="break-all text-start font-medium text-primary hover:underline"
        >
          {url}
        </a>
        <span className="text-xs text-fg-muted">{hint}</span>
      </div>
      <Button size="sm" variant="secondary" onClick={copy}>
        {copied ? t('store.copied') : t('store.copyLink')}
      </Button>
    </li>
  );
}

function OwnDomain({ addresses }: { addresses: StoreAddresses }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const client = useQueryClient();
  const [typed, setTyped] = useState('');
  const done = (data: StoreAddresses) => {
    client.setQueryData(KEY, data);
    void client.invalidateQueries({ queryKey: ['online', 'store'] });
  };
  const connect = useMutation({
    mutationFn: () => api.online.connectDomain(typed),
    onSuccess: (data) => {
      done(data);
      setTyped('');
    },
    onError: notify.fail,
  });
  const check = useMutation({
    mutationFn: () => api.online.checkDomain(),
    onSuccess: done,
    onError: notify.fail,
  });
  const primary = useMutation({
    mutationFn: (value: boolean) => api.online.setDomainPrimary(value),
    onSuccess: done,
    onError: notify.fail,
  });
  const remove = useMutation({
    mutationFn: () => api.online.removeDomain(),
    onSuccess: (data) => {
      done(data);
      notify.ok(t('domain.removed'));
    },
    onError: notify.fail,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (typed.trim()) connect.mutate();
  };
  const d = addresses.domain;

  return (
    <Section title={t('domain.ownTitle')} description={t('domain.ownHint')}>
      {!addresses.available ? (
        <Alert tone="info" title={t('domain.soonTitle')} className="mb-4">
          {t('domain.soonHint')}
        </Alert>
      ) : null}
      {!d ? (
        <form onSubmit={submit} className="flex flex-col gap-4" data-testid="domain-connect">
          <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm text-fg-muted">
            <li>{t('domain.how1')}</li>
            <li>{t('domain.how2')}</li>
            <li>{t('domain.how3')}</li>
            <li>{t('domain.how4')}</li>
          </ol>
          <fieldset disabled={!addresses.available} className="flex flex-wrap items-end gap-2">
            <Field label={t('domain.ownLabel')} className="min-w-56 flex-1">
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  placeholder="your-store.com"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                />
              )}
            </Field>
            <Button type="submit" loading={connect.isPending} disabled={!typed.trim()}>
              {t('domain.connect')}
            </Button>
          </fieldset>
        </form>
      ) : (
        <ConnectedDomain
          domain={d}
          target={addresses.target ?? ''}
          busy={check.isPending || primary.isPending || remove.isPending}
          onCheck={() => check.mutate()}
          onPrimary={(value) => primary.mutate(value)}
          onRemove={() => {
            if (window.confirm(t('domain.removeConfirm', { domain: d.domain }))) remove.mutate();
          }}
          checking={check.isPending}
        />
      )}
    </Section>
  );
}

const STATUS_TONE = {
  pending: 'warning',
  verifying: 'primary',
  active: 'success',
  failed: 'danger',
  removed: 'neutral',
} as const;

function ConnectedDomain({
  domain: d,
  target,
  busy,
  checking,
  onCheck,
  onPrimary,
  onRemove,
}: {
  domain: StoreDomain;
  target: string;
  busy: boolean;
  checking: boolean;
  onCheck: () => void;
  onPrimary: (value: boolean) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const working = d.status === 'active';
  // Worked before and stopped (expired at the provider, record removed): the store is on its
  // Arabat address meanwhile. The checks behind it are the platform's business, not the merchant's.
  const stopped = !working && d.activatedAt !== null;
  const address = `www.${d.domain}`;
  const rootWorks = d.root.status === 'active' && d.root.certificate === 'active';
  const required = d.records.filter((r) => r.purpose !== 'root');
  const steps = [
    { key: 'record', done: d.www.status === 'active' },
    { key: 'certificate', done: d.www.certificate === 'active' },
    { key: 'live', done: working },
  ];
  const errors = [...new Set(d.www.errors)];
  return (
    <div className="flex flex-col gap-5" data-testid="domain-connected">
      <div className="flex flex-wrap items-center gap-3">
        <span dir="ltr" className="text-lg font-bold">
          {d.domain}
        </span>
        <Badge tone={stopped ? 'danger' : STATUS_TONE[d.status]} data-testid="domain-status">
          {stopped ? t('domain.status_stopped') : t(`domain.status_${d.status}`)}
        </Badge>
        {d.isPrimary ? <Badge tone="success">{t('domain.main')}</Badge> : null}
      </div>

      {working ? (
        <Alert tone="success" title={t('domain.workingTitle')}>
          {t(d.isPrimary ? 'domain.workingHint' : 'domain.workingNotMain', { address })}
        </Alert>
      ) : stopped ? (
        <div className="flex flex-col gap-2">
          <Alert tone="danger" title={t('domain.stoppedTitle')}>
            {t('domain.stoppedHint', { domain: d.domain })}
          </Alert>
          <RecordsTable rows={required} label={(purpose) => t(`domain.purpose_${purpose}`)} />
        </div>
      ) : (
        <>
          <ol className="flex flex-col gap-0 sm:flex-row" data-testid="domain-steps">
            {steps.map((step, i) => (
              <li
                key={step.key}
                className="flex flex-1 items-center gap-2 py-1.5 sm:flex-col sm:text-center"
              >
                <span
                  className={cn(
                    'grid size-8 shrink-0 place-items-center rounded-full border-2 text-xs font-bold',
                    step.done
                      ? 'border-success bg-success text-white'
                      : 'border-border text-fg-muted',
                  )}
                >
                  {step.done ? '✓' : i + 1}
                </span>
                <span className="text-sm font-medium">{t(`domain.step_${step.key}`)}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{t('domain.dnsTitle')}</p>
            <RecordsTable rows={required} label={(purpose) => t(`domain.purpose_${purpose}`)} />
            <p className="text-xs text-fg-muted">{t('domain.dnsHint')}</p>
            <p className="text-xs text-fg-muted">
              {t('domain.rootOptional', { domain: d.domain, target, address })}
            </p>
          </div>
          {errors.length > 0 ? (
            <Alert tone="warning" title={t('domain.problemsTitle')}>
              <ul className="list-disc ps-5" dir="ltr">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
        </>
      )}

      {working && !rootWorks ? (
        <p className="text-sm text-fg-muted" data-testid="domain-root-tip">
          {t('domain.rootTip', { domain: d.domain, address })}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {!working ? (
          <Button onClick={onCheck} loading={checking} disabled={busy}>
            {t('domain.verify')}
          </Button>
        ) : d.isPrimary ? (
          <Button variant="secondary" onClick={() => onPrimary(false)} disabled={busy}>
            {t('domain.useArabat')}
          </Button>
        ) : (
          <Button onClick={() => onPrimary(true)} disabled={busy}>
            {t('domain.makeMain')}
          </Button>
        )}
        <Button variant="ghost" onClick={onRemove} disabled={busy}>
          {t('domain.remove')}
        </Button>
      </div>
      {!working && !stopped ? (
        <p className="text-xs text-fg-muted">{t('domain.statusUpdates')}</p>
      ) : null}
    </div>
  );
}

function RecordsTable({
  rows,
  label,
}: {
  rows: StoreDomain['records'];
  label: (purpose: StoreDomain['records'][number]['purpose']) => string;
}) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm" dir="ltr" data-testid="dns-records">
        <thead className="bg-surface-muted text-xs text-fg-muted">
          <tr>
            <th className="px-3 py-2 text-start">{t('domain.dns_type')}</th>
            <th className="px-3 py-2 text-start">{t('domain.dns_name')}</th>
            <th className="px-3 py-2 text-start">{t('domain.dns_value')}</th>
            <th className="px-3 py-2 text-start" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.type}-${r.name}`} className="border-t border-border">
              <td className="px-3 py-2 font-mono">{r.type}</td>
              <td className="px-3 py-2 font-mono">{r.name}</td>
              <td className="break-all px-3 py-2 font-mono">{r.value}</td>
              <td className="px-3 py-2 text-xs text-fg-muted" dir="auto">
                {label(r.purpose)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
