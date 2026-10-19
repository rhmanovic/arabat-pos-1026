import type { SaveSiteApp, SiteApp, SiteAppIcon } from '@arabat/contracts';
import { SITE_APP_ICONS } from '@arabat/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
} from '@arabat/ui';
import { ErrorState, useApi, useErrorMessage, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { platformKey, useFormat, useRole } from '../shared.js';

const KEY = [...platformKey, 'site-apps'];

/** The "Our apps" menu of the public site (ADR-0117): add, edit, hide, reorder, delete. */
export function SiteAppsPage() {
  const { t } = useTranslation();
  const api = useApi();
  const f = useFormat();
  const { can } = useRole();
  const editable = can('platform.super_admin', 'platform.billing');
  const [editing, setEditing] = useState<SiteApp | 'new' | null>(null);
  const apps = useQuery({ queryKey: KEY, queryFn: () => api.platform.siteApps() });
  return (
    <div>
      <PageHeader
        title={t('siteApps.title')}
        description={t('siteApps.subtitle')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => window.open('/', '_blank')}>
              {t('siteApps.openSite')}
            </Button>
            {editable ? (
              <Button onClick={() => setEditing('new')}>{t('siteApps.newApp')}</Button>
            ) : null}
          </div>
        }
      />
      <DataTable
        caption={t('siteApps.title')}
        loading={apps.isPending}
        error={
          apps.isError ? (
            <ErrorState error={apps.error} onRetry={() => void apps.refetch()} />
          ) : null
        }
        rows={apps.data?.apps}
        rowKey={(a) => a.id}
        {...(editable ? { onRowClick: (a: SiteApp) => setEditing(a) } : {})}
        columns={[
          {
            key: 'name',
            header: t('siteApps.name'),
            cell: (a) => (
              <span className="flex flex-wrap items-center gap-1">
                <span className="font-medium">{f.planName(a)}</span>
                {a.status === 'hidden' ? <Badge>{t('siteApps.hidden')}</Badge> : null}
              </span>
            ),
          },
          {
            key: 'url',
            header: t('siteApps.url'),
            cell: (a) => (
              <span dir="ltr" className="font-mono text-xs">
                {a.url}
                {a.openInNewTab ? ' ↗' : ''}
              </span>
            ),
          },
          {
            key: 'icon',
            header: t('siteApps.icon'),
            hideBelow: 'md',
            cell: (a) => t(`siteApps.icons.${a.icon}`),
          },
          {
            key: 'order',
            header: t('siteApps.sortOrder'),
            hideBelow: 'md',
            cell: (a) => a.sortOrder,
          },
        ]}
      />
      {editing ? (
        <SiteAppDialog app={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function SiteAppDialog({ app, onClose }: { app: SiteApp | null; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [v, setV] = useState({
    nameAr: app?.nameAr ?? '',
    nameEn: app?.nameEn ?? '',
    descriptionAr: app?.descriptionAr ?? '',
    descriptionEn: app?.descriptionEn ?? '',
    url: app?.url ?? '/',
    icon: (app?.icon ?? 'other') as SiteAppIcon,
    openInNewTab: app?.openInNewTab ?? false,
    status: app?.status ?? 'active',
    sortOrder: String(app?.sortOrder ?? 100),
  });
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  const save = useMutation({
    mutationFn: () => {
      const body: SaveSiteApp = {
        nameAr: v.nameAr,
        nameEn: v.nameEn,
        descriptionAr: v.descriptionAr,
        descriptionEn: v.descriptionEn,
        url: v.url,
        icon: v.icon,
        openInNewTab: v.openInNewTab,
        status: v.status,
        sortOrder: Number(v.sortOrder),
        version: app?.version ?? 0,
      };
      return api.platform.saveSiteApp(app?.id ?? null, body);
    },
    onSuccess: async () => {
      await refresh();
      notify.ok(t('siteApps.saved'));
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.platform.deleteSiteApp(app!.id),
    onSuccess: async () => {
      await refresh();
      notify.ok(t('siteApps.deleted'));
      onClose();
    },
  });
  const text = (
    key: 'nameAr' | 'nameEn' | 'descriptionAr' | 'descriptionEn' | 'url' | 'sortOrder',
    label: string,
    dir?: 'ltr',
    hint?: string,
  ) => (
    <Field label={label} {...(hint ? { hint } : {})}>
      {(p) => (
        <Input
          {...p}
          {...(dir ? { dir } : {})}
          value={v[key]}
          onChange={(e) => set({ [key]: e.target.value })}
        />
      )}
    </Field>
  );
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={app ? t('siteApps.edit') : t('siteApps.newApp')}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div>
            {app ? (
              confirmDelete ? (
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  {t('siteApps.deleteConfirm')}
                  <Button
                    variant="danger"
                    size="sm"
                    loading={remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    {t('siteApps.deleteYes')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                    {t('siteApps.deleteNo')}
                  </Button>
                </span>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                  {t('siteApps.delete')}
                </Button>
              )
            ) : null}
          </div>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('siteApps.save')}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {text('nameAr', t('siteApps.nameAr'))}
        {text('nameEn', t('siteApps.nameEn'), 'ltr')}
        {text('descriptionAr', t('siteApps.descriptionAr'))}
        {text('descriptionEn', t('siteApps.descriptionEn'), 'ltr')}
        {text('url', t('siteApps.url'), 'ltr', t('siteApps.urlHint'))}
        <Field label={t('siteApps.icon')}>
          {(p) => (
            <Select
              {...p}
              value={v.icon}
              onChange={(e) => set({ icon: e.target.value as SiteAppIcon })}
            >
              {SITE_APP_ICONS.map((icon) => (
                <option key={icon} value={icon}>
                  {t(`siteApps.icons.${icon}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('siteApps.status')}>
          {(p) => (
            <Select
              {...p}
              value={v.status}
              onChange={(e) => set({ status: e.target.value as 'active' | 'hidden' })}
            >
              <option value="active">{t('siteApps.statusActive')}</option>
              <option value="hidden">{t('siteApps.statusHidden')}</option>
            </Select>
          )}
        </Field>
        {text('sortOrder', t('siteApps.sortOrder'), 'ltr', t('siteApps.sortOrderHint'))}
        <Checkbox
          label={t('siteApps.openInNewTab')}
          checked={v.openInNewTab}
          onChange={(e) => set({ openInNewTab: e.target.checked })}
        />
        {save.isError ? (
          <Alert tone="danger" className="sm:col-span-2">
            {message(save.error)}
          </Alert>
        ) : null}
        {remove.isError ? (
          <Alert tone="danger" className="sm:col-span-2">
            {message(remove.error)}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
