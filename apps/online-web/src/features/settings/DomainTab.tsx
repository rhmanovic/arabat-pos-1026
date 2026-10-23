import { Alert, Badge, Button, Field, Input, Section, Select, cn } from '@arabat/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/*
 * The store's own domain (ADR-0135, plan in docs/CUSTOM_DOMAINS_PLAN.md): search a name, buy it
 * through Cloudflare, connect it and check the connection. Only the interface exists in this
 * phase: the steps that need the server are disabled and say so; nothing is searched or bought.
 */

const TLDS = ['.com', '.store', '.shop', '.net', '.co', '.online'] as const;
const STEPS = ['search', 'buy', 'connect', 'verify', 'secure', 'live'] as const;

export function DomainTab({ url, slug }: { url: string; slug: string }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'new' | 'own'>('new');
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  const host = new URL(url).host;
  // The store's own sub-domain (ADR-0136) when its address is one; the shared domain otherwise.
  const subdomain = host.startsWith(`${slug}.`);
  const zone = subdomain ? host.slice(slug.length + 1) : host.replace(/^www\./, '');
  return (
    <div className="flex flex-col gap-4" data-testid="domain-tab">
      <Section title={t('domain.currentTitle')} description={t('domain.currentHint')}>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            dir="ltr"
            className="font-semibold text-primary hover:underline"
          >
            {url}
          </a>
          <Button size="sm" variant="secondary" onClick={copy}>
            {copied ? t('store.copied') : t('store.copyLink')}
          </Button>
          <Badge tone="success">{t('domain.active')}</Badge>
        </div>
        {subdomain ? (
          <p className="mt-3 text-sm text-fg-muted" data-testid="domain-subdomain">
            {t('domain.subdomainActive')}
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            {t('domain.subdomain')}:
            <span dir="ltr" className="font-medium text-fg">{`${slug}.arabatapp.com`}</span>
            <Badge>{t('gateways.soon')}</Badge>
          </div>
        )}
      </Section>

      <Alert tone="info" title={t('domain.soonTitle')}>
        {t('domain.soonHint')}
      </Alert>

      <Section title={t('domain.ownTitle')} description={t('domain.ownHint')}>
        <div
          role="radiogroup"
          aria-label={t('domain.ownTitle')}
          className="mb-4 inline-flex rounded-lg border border-border bg-surface p-1"
        >
          {(['new', 'own'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-semibold',
                mode === m ? 'bg-primary text-primary-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {t(`domain.mode_${m}`)}
            </button>
          ))}
        </div>

        {mode === 'new' ? (
          <fieldset disabled className="flex flex-col gap-4 opacity-80" data-testid="domain-search">
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t('domain.searchLabel')} className="min-w-48 flex-1">
                {(p) => <Input {...p} dir="ltr" placeholder={slug} />}
              </Field>
              <Field label={t('domain.extension')} className="w-32">
                {(p) => (
                  <Select {...p} defaultValue=".com" dir="ltr">
                    {TLDS.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button>{t('domain.search')}</Button>
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 bg-surface-muted px-3 py-2 text-xs font-semibold text-fg-muted">
                <span>{t('domain.col_name')}</span>
                <span>{t('domain.col_status')}</span>
                <span>{t('domain.col_price')}</span>
                <span />
              </div>
              <p className="px-3 py-6 text-center text-sm text-fg-muted">
                {t('domain.resultsEmpty')}
              </p>
            </div>
            <p className="text-xs text-fg-muted">{t('domain.buyNote')}</p>
          </fieldset>
        ) : (
          <fieldset
            disabled
            className="flex flex-col gap-4 opacity-80"
            data-testid="domain-connect"
          >
            <Field label={t('domain.ownLabel')}>
              {(p) => <Input {...p} dir="ltr" placeholder="www.your-store.com" />}
            </Field>
            <div>
              <p className="mb-2 text-sm font-medium">{t('domain.dnsTitle')}</p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm" dir="ltr">
                  <thead className="bg-surface-muted text-xs text-fg-muted">
                    <tr>
                      <th className="px-3 py-2 text-start">{t('domain.dns_type')}</th>
                      <th className="px-3 py-2 text-start">{t('domain.dns_name')}</th>
                      <th className="px-3 py-2 text-start">{t('domain.dns_value')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-border">
                      <td className="px-3 py-2 font-mono">CNAME</td>
                      <td className="px-3 py-2 font-mono">www</td>
                      <td className="px-3 py-2 font-mono">{`stores.${zone}`}</td>
                    </tr>
                    <tr className="border-t border-border">
                      <td className="px-3 py-2 font-mono">TXT</td>
                      <td className="px-3 py-2 font-mono">_arabat</td>
                      <td className="px-3 py-2 font-mono text-fg-muted">
                        {t('domain.dnsTxtLater')}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-fg-muted">{t('domain.dnsHint')}</p>
            </div>
            <Button className="w-fit">{t('domain.verify')}</Button>
          </fieldset>
        )}
      </Section>

      <Section title={t('domain.stepsTitle')} description={t('domain.stepsHint')}>
        <ol className="flex flex-col gap-0 sm:flex-row" data-testid="domain-steps">
          {STEPS.map((step, i) => (
            <li
              key={step}
              className="flex flex-1 items-center gap-2 py-1.5 sm:flex-col sm:text-center"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full border-2 border-border text-xs font-bold text-fg-muted">
                {i + 1}
              </span>
              <span className="text-sm font-medium">{t(`domain.step_${step}`)}</span>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
