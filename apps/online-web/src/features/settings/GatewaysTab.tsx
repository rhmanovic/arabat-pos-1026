import { Alert, Badge, Button, Checkbox, Field, Input, Section, Select, cn } from '@arabat/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/*
 * Online payment gateways (ADR-0135): the screens a merchant will use to connect a licensed
 * payment provider. Only the interface exists in this phase: every control that needs the
 * server is disabled and says so; nothing here is sent or stored.
 */

const PROVIDERS = ['myfatoorah', 'tap', 'upayments', 'hesabe', 'ottu'] as const;
type Provider = (typeof PROVIDERS)[number];
const METHODS = ['knet', 'cards', 'applePay', 'googlePay', 'amex'] as const;

export function GatewaysTab({ origin }: { origin: string }) {
  const { t } = useTranslation();
  // Choosing a provider only changes what the (disabled) form shows: nothing is saved.
  const [provider, setProvider] = useState<Provider>('myfatoorah');
  const webhook = `${origin}/api/v1/webhooks/payments/${provider}`;
  return (
    <div className="flex flex-col gap-4" data-testid="gateways-tab">
      <Alert tone="info" title={t('gateways.soonTitle')}>
        {t('gateways.soonHint')}
      </Alert>

      <Section title={t('gateways.providersTitle')} description={t('gateways.providersHint')}>
        <ul
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          role="radiogroup"
          aria-label={t('gateways.providersTitle')}
          data-testid="gateway-providers"
        >
          {PROVIDERS.map((p) => (
            <li key={p}>
              <button
                type="button"
                role="radio"
                aria-checked={provider === p}
                onClick={() => setProvider(p)}
                className={cn(
                  'flex h-full w-full items-start gap-3 rounded-xl border p-4 text-start transition-colors',
                  provider === p
                    ? 'border-primary bg-primary-soft'
                    : 'border-border bg-surface hover:border-border-strong',
                )}
              >
                <span
                  aria-hidden
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-muted text-lg font-extrabold text-primary"
                >
                  {t(`gateways.provider_${p}`).slice(0, 1)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 font-semibold">
                    {t(`gateways.provider_${p}`)}
                    <Badge>{t('gateways.soon')}</Badge>
                  </span>
                  <span className="text-xs text-fg-muted">{t(`gateways.provider_${p}Hint`)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title={t('gateways.connectTitle', { provider: t(`gateways.provider_${provider}`) })}
        description={t('gateways.connectHint')}
      >
        <fieldset
          disabled
          className="grid gap-4 opacity-80 sm:grid-cols-2"
          data-testid="gateway-form"
        >
          <Field label={t('gateways.mode')}>
            {(p) => (
              <Select {...p} defaultValue="test">
                <option value="test">{t('gateways.mode_test')}</option>
                <option value="live">{t('gateways.mode_live')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('gateways.merchantId')}>
            {(p) => <Input {...p} dir="ltr" placeholder="MID-000000" />}
          </Field>
          <Field label={t('gateways.apiKey')} hint={t('gateways.apiKeyHint')}>
            {(p) => <Input {...p} type="password" dir="ltr" placeholder="••••••••••••" />}
          </Field>
          <Field label={t('gateways.secret')}>
            {(p) => <Input {...p} type="password" dir="ltr" placeholder="••••••••••••" />}
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('gateways.webhook')} hint={t('gateways.webhookHint')}>
              {(p) => <Input {...p} dir="ltr" readOnly value={webhook} />}
            </Field>
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button variant="secondary">{t('gateways.test')}</Button>
            <Button>{t('gateways.connect')}</Button>
          </div>
        </fieldset>
      </Section>

      <Section title={t('gateways.methodsTitle')} description={t('gateways.methodsHint')}>
        <fieldset
          disabled
          className="grid gap-2 opacity-80 sm:grid-cols-2"
          data-testid="gateway-methods"
        >
          {METHODS.map((m) => (
            <Checkbox
              key={m}
              label={t(`gateways.method_${m}`)}
              description={t(`gateways.method_${m}Hint`)}
              defaultChecked={m === 'knet' || m === 'cards'}
            />
          ))}
        </fieldset>
      </Section>

      <Section title={t('gateways.feesTitle')} description={t('gateways.feesHint')}>
        <fieldset disabled className="grid gap-4 opacity-80 sm:grid-cols-2">
          <Field label={t('gateways.feesPaidBy')}>
            {(p) => (
              <Select {...p} defaultValue="store">
                <option value="store">{t('gateways.feesPaidBy_store')}</option>
                <option value="customer">{t('gateways.feesPaidBy_customer')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('gateways.settlement')} hint={t('gateways.settlementHint')}>
            {(p) => (
              <Select {...p} defaultValue="">
                <option value="">{t('gateways.settlementChoose')}</option>
              </Select>
            )}
          </Field>
          <Checkbox
            className="sm:col-span-2"
            label={t('gateways.refunds')}
            description={t('gateways.refundsHint')}
          />
        </fieldset>
      </Section>
    </div>
  );
}
