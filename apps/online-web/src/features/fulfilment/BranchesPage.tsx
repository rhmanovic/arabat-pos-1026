import type { OnlineStoreBranch, SaveOnlineStoreBranch } from '@arabat/contracts';
import { Badge, Button, Checkbox, Dialog, Field, Input, PageHeader, Section } from '@arabat/ui';
import { AccessDenied, ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBranches, useSession } from '../../app/context.js';
import { key } from '../shared.js';
import { SortableList, SortableRow } from '../sortable.js';
import { HoursEditor } from './HoursEditor.js';

/**
 * Branches serving the store (ADR-0123): pickup and / or delivery, preparation time, own
 * hours. While none is configured, the fulfilment branch of the settings serves everything.
 */
export function BranchesPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  if (!can('online.manage')) return <AccessDenied />;
  return (
    <div>
      <PageHeader title={t('nav.branches')} description={t('storeBranches.hint')} />
      <BranchList />
    </div>
  );
}

function BranchList() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const all = useBranches();
  const [editing, setEditing] = useState<{
    branchId: string;
    current: OnlineStoreBranch | null;
  } | null>(null);
  const configured = useQuery({
    queryKey: [...key, 'store-branches'],
    queryFn: () => api.online.storeBranches(),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const order = useMutation({
    mutationFn: (ids: string[]) => api.online.orderStoreBranches(ids),
    onSuccess: refresh,
    onError: async (error) => {
      await refresh();
      notify.fail(error);
    },
  });
  const remove = useMutation({
    mutationFn: (branchId: string) => api.online.removeStoreBranch(branchId),
    onSuccess: async () => {
      await refresh();
      notify.ok(t('storeBranches.removed'));
    },
    onError: notify.fail,
  });
  if (configured.isPending) return null;
  if (configured.isError)
    return <ErrorState error={configured.error} onRetry={() => void configured.refetch()} />;
  const serving = configured.data.branches;
  const ids = serving.map((b) => b.branchId);
  const others = all.filter((b) => b.status === 'active' && !ids.includes(b.id));
  const summary = (b: OnlineStoreBranch) =>
    [
      b.pickupEnabled ? t('store.pickup') : null,
      b.deliveryEnabled ? t('store.delivery') : null,
      t('storeBranches.preparationShort', { count: b.preparationMinutes }),
      b.hours ? t('storeBranches.ownHours') : t('storeBranches.storeHours'),
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <div className="flex flex-col gap-4">
      <Section title={t('storeBranches.servingTitle')} description={t('products.dragHint')}>
        {serving.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('storeBranches.noneHint')}</p>
        ) : (
          <SortableList ids={ids} onOrder={(next) => order.mutate(next)}>
            {serving.map((b, index) => (
              <SortableRow
                key={b.branchId}
                id={b.branchId}
                label={localizedName(b, i18n.language)}
                first={index === 0}
                last={index === serving.length - 1}
                onMove={(by) => {
                  const next = [...ids];
                  next.splice(index, 1);
                  next.splice(index + by, 0, b.branchId);
                  order.mutate(next);
                }}
                actions={
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setEditing({ branchId: b.branchId, current: b })}
                    >
                      {t('products.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={remove.isPending && remove.variables === b.branchId}
                      onClick={() => remove.mutate(b.branchId)}
                    >
                      {t('storeBranches.remove')}
                    </Button>
                  </>
                }
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="line-clamp-2 font-medium break-words">
                      {localizedName(b, i18n.language)}
                    </span>
                    {!b.active ? <Badge>{t('areas.inactive')}</Badge> : null}
                  </span>
                  <span className="block text-xs text-fg-muted">{summary(b)}</span>
                </span>
              </SortableRow>
            ))}
          </SortableList>
        )}
      </Section>
      {others.length > 0 ? (
        <Section title={t('storeBranches.othersTitle')} description={t('storeBranches.othersHint')}>
          <ul className="flex flex-col gap-2">
            {others.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3"
              >
                <span className="font-medium">{localizedName(b, i18n.language)}</span>
                <Button size="sm" onClick={() => setEditing({ branchId: b.id, current: null })}>
                  {t('storeBranches.addToStore')}
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {editing ? (
        <BranchDialog
          branchId={editing.branchId}
          current={editing.current}
          name={localizedName(
            all.find((b) => b.id === editing.branchId) ?? { nameEn: null, nameAr: null },
            i18n.language,
          )}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await refresh();
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function BranchDialog({
  branchId,
  current,
  name,
  onClose,
  onSaved,
}: {
  branchId: string;
  current: OnlineStoreBranch | null;
  name: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const [v, setV] = useState<SaveOnlineStoreBranch>({
    pickupEnabled: current?.pickupEnabled ?? true,
    deliveryEnabled: current?.deliveryEnabled ?? false,
    preparationMinutes: current?.preparationMinutes ?? 30,
    hours: current?.hours ?? null,
    active: current?.active ?? true,
  });
  const set = (patch: Partial<SaveOnlineStoreBranch>) => setV((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: () =>
      api.online.saveStoreBranch(branchId, {
        ...v,
        ...(current ? { version: current.version } : {}),
      }),
    onSuccess: async () => {
      notify.ok(t('common.saved'));
      await onSaved();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => (!open ? onClose() : undefined)}
      title={t('storeBranches.editTitle', { name })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Checkbox
            label={t('store.pickup')}
            checked={v.pickupEnabled ?? true}
            onChange={(e) => set({ pickupEnabled: e.target.checked })}
          />
          <Checkbox
            label={t('store.delivery')}
            checked={v.deliveryEnabled ?? false}
            onChange={(e) => set({ deliveryEnabled: e.target.checked })}
          />
          <Field label={t('storeBranches.preparation')} hint={t('storeBranches.preparationHint')}>
            {(p) => (
              <Input
                {...p}
                type="number"
                min={0}
                max={1440}
                dir="ltr"
                value={String(v.preparationMinutes ?? 30)}
                onChange={(e) => set({ preparationMinutes: Number(e.target.value) })}
              />
            )}
          </Field>
          <Checkbox
            label={t('areas.active')}
            checked={v.active ?? true}
            onChange={(e) => set({ active: e.target.checked })}
          />
        </div>
        <div>
          <p className="mb-1 text-sm font-medium">{t('hours.title')}</p>
          <HoursEditor
            value={v.hours ?? null}
            onChange={(hours) => set({ hours })}
            alwaysLabel={t('storeBranches.storeHours')}
          />
        </div>
      </div>
    </Dialog>
  );
}
