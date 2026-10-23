import type { OnlineStore, SaveOnlineStore } from '@arabat/contracts';
import { ApiError } from '@arabat/api-client';
import { RESERVED_STORE_SLUGS, STORE_SLUG_PATTERN } from '@arabat/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  PageHeader,
  Section,
  Select,
  cn,
} from '@arabat/ui';
import { AccessDenied, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { managerUrl, useBranches, useSession } from '../../app/context.js';
import { HoursEditor } from '../fulfilment/HoursEditor.js';
import { DomainTab } from './DomainTab.js';
import { GatewaysTab } from './GatewaysTab.js';
import { FloatingBar, key } from '../shared.js';

/** Store address, status, branding, fulfilment and payment options. */
export function SettingsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  if (!can('online.manage')) return <AccessDenied />;
  return (
    <div>
      <PageHeader title={t('nav.settings')} description={t('store.statusHint')} />
      <SettingsTab />
    </div>
  );
}

// ----------------------------------------------------------------------------- settings
function toForm(s: OnlineStore): SaveOnlineStore {
  return {
    slug: s.slug,
    status: s.status,
    nameEn: s.nameEn,
    nameAr: s.nameAr,
    taglineEn: s.taglineEn,
    taglineAr: s.taglineAr,
    announcementEn: s.announcementEn,
    announcementAr: s.announcementAr,
    primaryColor: s.primaryColor,
    contactPhone: s.contactPhone,
    contactEmail: s.contactEmail,
    fulfillmentBranchId: s.fulfillmentBranchId,
    pickupEnabled: s.pickupEnabled,
    deliveryEnabled: s.deliveryEnabled,
    deliveryFee: s.deliveryFee.amount,
    minimumOrder: s.minimumOrder.amount,
    reservationMinutes: s.reservationMinutes,
    payOnReceiptEnabled: s.payOnReceiptEnabled,
    hideOutOfStock: s.hideOutOfStock,
    hours: s.hours,
    schedulingEnabled: s.schedulingEnabled,
    slotMinutes: s.slotMinutes,
    slotCapacity: s.slotCapacity,
    notifyEmail: s.notifyEmail,
    accountsEnabled: s.accountsEnabled,
    version: s.version,
  };
}

/** Live check of a store address while the merchant types (debounced). */
function useSlugCheck(slug: string, current: string) {
  const api = useApi();
  const [debounced, setDebounced] = useState(slug);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(slug), 400);
    return () => clearTimeout(timer);
  }, [slug]);
  const normalized = debounced.trim().toLowerCase();
  const changed = normalized !== current.toLowerCase();
  const local: 'invalid' | 'reserved' | null = !STORE_SLUG_PATTERN.test(normalized)
    ? 'invalid'
    : RESERVED_STORE_SLUGS.includes(normalized)
      ? 'reserved'
      : null;
  const remote = useQuery({
    queryKey: [...key, 'slug', normalized],
    queryFn: () => api.online.slugAvailability(normalized),
    enabled: changed && local === null,
    staleTime: 10_000,
  });
  if (!changed) return { state: 'unchanged' as const, suggestions: [] as string[] };
  if (local) return { state: local, suggestions: [] as string[] };
  if (remote.isPending) return { state: 'checking' as const, suggestions: [] as string[] };
  if (remote.isError) return { state: 'unknown' as const, suggestions: [] as string[] };
  return {
    state: remote.data.available ? ('available' as const) : remote.data.reason!,
    suggestions: remote.data.suggestions,
  };
}

function SettingsTab() {
  const api = useApi();
  const store = useQuery({ queryKey: [...key, 'store'], queryFn: () => api.online.store() });
  return store.data ? <SettingsForm key={store.data.version} store={store.data} /> : null;
}

/** The settings in tabs, so the page stays short (the save bar serves every tab). */
const TABS = ['general', 'fulfilment', 'payments', 'domain'] as const;
type Tab = (typeof TABS)[number];
const FULFILMENT_FIELDS = [
  'fulfillmentBranchId',
  'reservationMinutes',
  'pickupEnabled',
  'deliveryEnabled',
  'deliveryFee',
  'minimumOrder',
  'slotMinutes',
  'slotCapacity',
  'schedulingEnabled',
  'hours',
];
/** The tab that holds a field the server refused. */
const tabOf = (field: string): Tab =>
  FULFILMENT_FIELDS.includes(field)
    ? 'fulfilment'
    : field === 'payOnReceiptEnabled'
      ? 'payments'
      : 'general';

function SettingsForm({ store }: { store: OnlineStore }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const branches = useBranches();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'general';
  const setTab = (next: Tab) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (next === 'general') n.delete('tab');
        else n.set('tab', next);
        return n;
      },
      { replace: true },
    );
  const [v, setV] = useState<SaveOnlineStore>(() => toForm(store));
  const dirty = JSON.stringify(v) !== JSON.stringify(toForm(store));
  const set = (patch: Partial<SaveOnlineStore>) => setV((x) => ({ ...x, ...patch }));
  /** Field problems the server reported on the last save, by field name. */
  const [issues, setIssues] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      setIssues({});
      return api.online.saveStore(v);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      notify.ok(t('common.saved'));
    },
    onError: (error) => {
      if (error instanceof ApiError && error.problem.issues?.length) {
        const fields = error.problem.issues.map((i) => i.path.split('.')[0] ?? i.path);
        setIssues(
          Object.fromEntries(
            error.problem.issues.map((i, n) => [
              fields[n]!,
              t(`store.issue_${fields[n]!}`, { defaultValue: i.message }),
            ]),
          ),
        );
        // The refused field may sit in another tab: open it, then bring the field into view.
        setTab(tabOf(fields[0]!));
        setTimeout(() => {
          const target = document.querySelector(`[data-field="${fields[0]!}"]`);
          if (target && typeof target.scrollIntoView === 'function')
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 0);
      }
      notify.fail(error);
    },
  });
  const FIELD_LABELS: Record<string, string> = {
    slug: t('store.slug'),
    status: t('store.storeStatus'),
    nameAr: t('store.nameAr'),
    nameEn: t('store.nameEn'),
    taglineAr: t('store.taglineAr'),
    taglineEn: t('store.taglineEn'),
    announcementAr: t('store.announcementAr'),
    announcementEn: t('store.announcementEn'),
    primaryColor: t('store.color'),
    contactPhone: t('store.contactPhone'),
    contactEmail: t('store.contactEmail'),
    fulfillmentBranchId: t('store.branch'),
    reservationMinutes: t('store.reservationMinutes'),
    pickupEnabled: t('store.pickup'),
    deliveryEnabled: t('store.delivery'),
    deliveryFee: t('store.deliveryFee'),
    minimumOrder: t('store.minimumOrder'),
    slotMinutes: t('store.slotMinutes'),
    slotCapacity: t('store.slotCapacity'),
    hours: t('hours.title'),
  };
  const text = (field: keyof SaveOnlineStore, label: string, props: { dir?: 'ltr' } = {}) => (
    <div data-field={field}>
      <Field label={label} error={issues[field]}>
        {(p) => (
          <Input
            {...p}
            {...props}
            value={(v[field] as string | null | undefined) ?? ''}
            onChange={(e) => set({ [field]: e.target.value } as Partial<SaveOnlineStore>)}
          />
        )}
      </Field>
    </div>
  );
  const ready = store.paymentMethods.filter((m) => m.ready);
  const slugCheck = useSlugCheck(v.slug, store.slug);
  const preview = addressWithSlug(store.url, store.slug, v.slug.trim().toLowerCase());
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(store.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  const slugMessage: Record<typeof slugCheck.state, string | null> = {
    unchanged: null,
    checking: t('store.slugChecking'),
    available: t('store.slugAvailable'),
    taken: t('store.slugTaken'),
    reserved: t('store.slugReserved'),
    invalid: t('store.slugInvalid'),
    rename_limit: t('store.slugRenameLimit'),
    unknown: null,
  };
  return (
    <div className="flex flex-col gap-4 pb-24 lg:pb-16">
      <div
        role="tablist"
        aria-label={t('settingsTabs.label')}
        className="-mx-1 flex gap-1 overflow-x-auto rounded-xl bg-surface-muted p-1 [scrollbar-width:none]"
      >
        {TABS.map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            id={`settings-tab-${x}`}
            aria-selected={tab === x}
            aria-controls={`settings-panel-${x}`}
            onClick={() => setTab(x)}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors',
              tab === x ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
            )}
          >
            <span aria-hidden>{TAB_ICONS[x]}</span>
            {t(`settingsTabs.${x}`)}
            {Object.keys(issues).some((f) => tabOf(f) === x) ? (
              <span className="size-2 rounded-full bg-danger" aria-hidden />
            ) : null}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`settings-panel-${tab}`}
        aria-labelledby={`settings-tab-${tab}`}
        className="flex flex-col gap-4"
      >
        {tab === 'general' ? (
          <>
            <Section title={t('store.addressSection')} description={t('store.addressHint')}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div data-field="slug">
                  <Field
                    label={t('store.slug')}
                    hint={t('store.slugFormat')}
                    error={
                      ['taken', 'reserved', 'invalid', 'rename_limit'].includes(slugCheck.state)
                        ? (slugMessage[slugCheck.state] ?? undefined)
                        : issues['slug']
                    }
                  >
                    {(p) => (
                      <Input
                        {...p}
                        dir="ltr"
                        autoComplete="off"
                        value={v.slug}
                        onChange={(e) => set({ slug: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
                <div className="text-sm">
                  <p className="text-fg-muted">{t('store.address')}</p>
                  <p dir="ltr" className="break-all font-medium" data-testid="store-url-preview">
                    {preview}
                  </p>
                  {slugCheck.state === 'available' || slugCheck.state === 'checking' ? (
                    <p
                      className={slugCheck.state === 'available' ? 'text-success' : 'text-fg-muted'}
                    >
                      {slugMessage[slugCheck.state]}
                    </p>
                  ) : null}
                  {slugCheck.suggestions.length > 0 ? (
                    <p className="mt-1 flex flex-wrap items-center gap-1">
                      <span className="text-fg-muted">{t('store.slugSuggestions')}</span>
                      {slugCheck.suggestions.map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant="secondary"
                          onClick={() => set({ slug: s })}
                        >
                          <span dir="ltr">{s}</span>
                        </Button>
                      ))}
                    </p>
                  ) : null}
                </div>
                <p className="flex flex-wrap items-center gap-2 text-sm sm:col-span-2">
                  {store.status === 'draft' ? (
                    <span dir="ltr">{store.url}</span>
                  ) : (
                    <a
                      className="text-primary hover:underline"
                      href={store.url}
                      target="_blank"
                      rel="noreferrer"
                      dir="ltr"
                    >
                      {store.url}
                    </a>
                  )}
                  <Button size="sm" variant="secondary" onClick={copy}>
                    {copied ? t('store.copied') : t('store.copyLink')}
                  </Button>
                </p>
              </div>
            </Section>
            <Section title={t('store.statusSection')} description={t('store.statusHint')}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div data-field="status">
                  <Field label={t('store.storeStatus')} error={issues['status']}>
                    {(p) => (
                      <Select
                        {...p}
                        value={v.status}
                        onChange={(e) =>
                          set({ status: e.target.value as SaveOnlineStore['status'] })
                        }
                      >
                        {(['draft', 'published', 'paused'] as const).map((s) => (
                          <option key={s} value={s}>
                            {t(`store.store_${s}`)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
              </div>
            </Section>
            <Section title={t('store.branding')}>
              <div className="grid gap-4 sm:grid-cols-2">
                {text('nameAr', t('store.nameAr'))}
                {text('nameEn', t('store.nameEn'), { dir: 'ltr' })}
                {text('taglineAr', t('store.taglineAr'))}
                {text('taglineEn', t('store.taglineEn'), { dir: 'ltr' })}
                {text('announcementAr', t('store.announcementAr'))}
                {text('announcementEn', t('store.announcementEn'), { dir: 'ltr' })}
                <Field label={t('store.color')}>
                  {(p) => (
                    <Input
                      {...p}
                      type="color"
                      className="h-10 w-20 p-1"
                      value={v.primaryColor}
                      onChange={(e) => set({ primaryColor: e.target.value })}
                    />
                  )}
                </Field>
                {text('contactPhone', t('store.contactPhone'), { dir: 'ltr' })}
                {text('contactEmail', t('store.contactEmail'), { dir: 'ltr' })}
                <Checkbox
                  className="sm:col-span-2"
                  label={t('store.notifyEmail')}
                  description={t('store.notifyEmailHint')}
                  checked={v.notifyEmail ?? true}
                  onChange={(e) => set({ notifyEmail: e.target.checked })}
                />
                <Checkbox
                  className="sm:col-span-2"
                  label={t('store.accounts')}
                  description={t('store.accountsHint')}
                  checked={v.accountsEnabled ?? true}
                  onChange={(e) => set({ accountsEnabled: e.target.checked })}
                />
              </div>
            </Section>
            <Section title={t('appearance.title')} description={t('appearance.hint')}>
              <div className="grid gap-4 sm:grid-cols-2">
                <ImageField kind="logo" url={store.logoUrl} />
                <ImageField kind="banner" url={store.bannerUrl} />
                <Checkbox
                  className="sm:col-span-2"
                  label={t('appearance.hideOutOfStock')}
                  description={t('appearance.hideOutOfStockHint')}
                  checked={v.hideOutOfStock ?? false}
                  onChange={(e) => set({ hideOutOfStock: e.target.checked })}
                />
              </div>
            </Section>
          </>
        ) : null}
        {tab === 'fulfilment' ? (
          <>
            <Section title={t('store.fulfillmentSection')} description={t('store.fulfillmentHint')}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div data-field="fulfillmentBranchId">
                  <Field label={t('store.branch')} error={issues['fulfillmentBranchId']}>
                    {(p) => (
                      <Select
                        {...p}
                        value={v.fulfillmentBranchId ?? ''}
                        onChange={(e) => set({ fulfillmentBranchId: e.target.value || null })}
                      >
                        <option value="">—</option>
                        {branches
                          .filter((b) => b.status === 'active')
                          .map((b) => (
                            <option key={b.id} value={b.id}>
                              {localizedName(b, i18n.language)}
                            </option>
                          ))}
                      </Select>
                    )}
                  </Field>
                </div>
                <div data-field="reservationMinutes">
                  <Field
                    label={t('store.reservationMinutes')}
                    hint={t('store.reservationHint')}
                    error={issues['reservationMinutes']}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        type="number"
                        min={5}
                        max={1440}
                        dir="ltr"
                        value={String(v.reservationMinutes)}
                        onChange={(e) => set({ reservationMinutes: Number(e.target.value) })}
                      />
                    )}
                  </Field>
                </div>
                <Checkbox
                  data-field="pickupEnabled"
                  label={t('store.pickup')}
                  description={
                    issues['pickupEnabled'] ? (
                      <span className="text-danger">{issues['pickupEnabled']}</span>
                    ) : undefined
                  }
                  checked={v.pickupEnabled}
                  onChange={(e) => set({ pickupEnabled: e.target.checked })}
                />
                <Checkbox
                  label={t('store.delivery')}
                  checked={v.deliveryEnabled}
                  onChange={(e) => set({ deliveryEnabled: e.target.checked })}
                />
                {text('deliveryFee', t('store.deliveryFee'), { dir: 'ltr' })}
                {text('minimumOrder', t('store.minimumOrder'), { dir: 'ltr' })}
                <p className="text-sm text-fg-muted sm:col-span-2">
                  {t('store.fulfilmentLinks')}{' '}
                  <Link className="text-primary hover:underline" to="/delivery-areas">
                    {t('nav.areas')}
                  </Link>
                  {' · '}
                  <Link className="text-primary hover:underline" to="/branches">
                    {t('nav.branches')}
                  </Link>
                </p>
              </div>
            </Section>
            <Section title={t('hours.title')} description={t('hours.hint')}>
              <div className="flex flex-col gap-4">
                <div data-field="hours">
                  <HoursEditor
                    value={v.hours ?? null}
                    onChange={(hours) => set({ hours })}
                    alwaysLabel={t('hours.always')}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Checkbox
                    className="sm:col-span-3"
                    label={t('store.scheduling')}
                    description={t('store.schedulingHint')}
                    checked={v.schedulingEnabled ?? false}
                    onChange={(e) => set({ schedulingEnabled: e.target.checked })}
                  />
                  <div data-field="slotMinutes">
                    <Field label={t('store.slotMinutes')} error={issues['slotMinutes']}>
                      {(p) => (
                        <Select
                          {...p}
                          value={String(v.slotMinutes ?? 30)}
                          onChange={(e) => set({ slotMinutes: Number(e.target.value) })}
                        >
                          {[15, 30, 45, 60, 90, 120].map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  </div>
                  <div data-field="slotCapacity">
                    <Field
                      label={t('store.slotCapacity')}
                      hint={t('store.slotCapacityHint')}
                      error={issues['slotCapacity']}
                    >
                      {(p) => (
                        <Input
                          {...p}
                          type="number"
                          min={1}
                          max={1000}
                          dir="ltr"
                          value={v.slotCapacity ?? ''}
                          onChange={(e) =>
                            set({
                              slotCapacity: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                        />
                      )}
                    </Field>
                  </div>
                </div>
              </div>
            </Section>
          </>
        ) : null}
        {tab === 'payments' ? (
          <>
            <Section title={t('store.paymentsSection')} description={t('store.paymentsHint')}>
              <Checkbox
                label={t('store.payOnReceipt')}
                description={t('store.payOnReceiptHint')}
                checked={v.payOnReceiptEnabled}
                onChange={(e) => set({ payOnReceiptEnabled: e.target.checked })}
              />
              {store.paymentMethods.length === 0 ? (
                <p className="mt-3 text-sm text-fg-muted">{t('store.noPaymentMethods')}</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-1 text-sm">
                  {store.paymentMethods.map((m) => (
                    <li key={m.id} className="flex items-center gap-2">
                      {localizedName(m, i18n.language)} ({m.provider})
                      <Badge tone={m.ready ? 'success' : 'warning'}>
                        {m.ready ? t('store.gatewayReady') : t('store.gatewayNotConnected')}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              {!v.payOnReceiptEnabled && ready.length === 0 ? (
                <Alert tone="warning" className="mt-2">
                  {t('store.noPaymentOption')}
                </Alert>
              ) : null}
              <p className="mt-2 text-sm">
                <a className="text-primary hover:underline" href={managerUrl('payments')}>
                  {t('store.managePayments')}
                </a>
              </p>
            </Section>
            <GatewaysTab origin={new URL(store.url).origin} />
          </>
        ) : null}
        {tab === 'domain' ? <DomainTab /> : null}
      </div>
      {Object.keys(issues).length > 0 ? (
        <Alert tone="danger" title={t('store.fixFields')}>
          <ul className="list-disc ps-5">
            {Object.entries(issues).map(([field, message]) => (
              <li key={field}>
                {FIELD_LABELS[field] ?? field}: {message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <FloatingBar label={t('store.actions')}>
        {dirty ? (
          <Badge tone="warning" data-testid="settings-unsaved">
            {t('store.unsaved')}
          </Badge>
        ) : null}
        <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
          {t('common.save')}
        </Button>
      </FloatingBar>
    </div>
  );
}

const TAB_ICONS: Record<Tab, string> = {
  general: '🏪',
  fulfilment: '🚚',
  payments: '💳',
  domain: '🌐',
};

/** Logo or banner of the store (ADR-0121): shown at once; uploads save on their own. */
function ImageField({ kind, url }: { kind: 'logo' | 'banner'; url: string | null }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const upload = useMutation({
    mutationFn: (file: File) => api.online.uploadStoreImage(kind, file),
    onSuccess: async () => {
      notify.ok(t('appearance.imageSaved'));
      await refresh();
    },
    onError: notify.fail,
  });
  const remove = useMutation({
    mutationFn: () => api.online.removeStoreImage(kind),
    onSuccess: refresh,
    onError: notify.fail,
  });
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{t(`appearance.${kind}`)}</p>
      <div
        className={
          kind === 'logo'
            ? 'size-20 overflow-hidden rounded-full border border-border bg-surface-muted'
            : 'aspect-[3/1] w-full overflow-hidden rounded-md border border-border bg-surface-muted'
        }
      >
        {url ? <img src={url} alt="" className="size-full object-cover" /> : null}
      </div>
      <p className="text-xs text-fg-muted">{t(`appearance.${kind}Hint`)}</p>
      <div className="flex gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label={t(`appearance.upload_${kind}`)}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = '';
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          loading={upload.isPending}
          onClick={() => fileInput.current?.click()}
        >
          {t(`appearance.upload_${kind}`)}
        </Button>
        {url ? (
          <Button
            size="sm"
            variant="ghost"
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {t('appearance.remove')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The store's address with another slug: its sub-domain (`store666.arabatapp.com`, ADR-0136)
 * or the last part of the shared `/store/{slug}` address.
 */
export function addressWithSlug(url: string, current: string, slug: string): string {
  const address = new URL(url);
  if (address.hostname.startsWith(`${current}.`))
    return `${address.protocol}//${slug}${address.host.slice(current.length)}`;
  return url.replace(/[^/]*$/, slug);
}
