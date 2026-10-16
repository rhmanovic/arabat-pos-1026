import type { PrintAgent } from '@arabat/contracts';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
} from '@arabat/ui';
import { ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBranchContext, useBranchName, useSession } from '../../app/context.js';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';

export const printersKey = ['manager', 'print-agents'] as const;

/**
 * Receipt printers (ADR-0111): the print agents of the company, their online state and the
 * auto-print setting. A new agent's token is shown exactly once.
 */
export function PrintersPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const branchName = useBranchName();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PrintAgent | null>(null);
  const agents = useQuery({
    queryKey: printersKey,
    queryFn: () => api.printing.agents(),
    // The online state changes while the page is open.
    refetchInterval: 15_000,
  });
  const settings = useQuery({
    queryKey: [...printersKey, 'settings'],
    queryFn: () => api.printing.settings(),
    enabled: can('merchant.settings.read'),
  });
  const toggle = useMutation({
    mutationFn: (autoPrintReceipts: boolean) => api.printing.updateSettings({ autoPrintReceipts }),
    onSuccess: (data) => {
      queryClient.setQueryData([...printersKey, 'settings'], data);
      notify.ok(t('common.saved'));
    },
    onError: notify.fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.printing.deleteAgent(id),
    onSuccess: async () => {
      setRemoving(null);
      await queryClient.invalidateQueries({ queryKey: printersKey });
      notify.ok(t('printers.removed'));
    },
    onError: notify.fail,
  });
  return (
    <div>
      <PageHeader
        title={t('printers.title')}
        description={t('printers.subtitle')}
        actions={<Button onClick={() => setAdding(true)}>{t('printers.add')}</Button>}
      />
      {settings.data ? (
        <div className="mb-6">
          <Checkbox
            label={t('printers.autoPrint')}
            description={t('printers.autoPrintHint')}
            checked={settings.data.autoPrintReceipts}
            disabled={!can('merchant.settings.update') || toggle.isPending}
            onChange={(e) => toggle.mutate(e.target.checked)}
          />
        </div>
      ) : null}
      <DataTable
        caption={t('printers.title')}
        loading={agents.isPending}
        error={
          agents.isError ? (
            <ErrorState error={agents.error} onRetry={() => void agents.refetch()} />
          ) : null
        }
        empty={t('printers.empty')}
        rows={agents.data?.agents}
        rowKey={(a) => a.id}
        columns={[
          { key: 'name', header: t('common.name'), cell: (a) => <bdi>{a.name}</bdi> },
          {
            key: 'branch',
            header: t('inventory.branch'),
            cell: (a) => (a.branchId ? (branchName(a.branchId) ?? '—') : t('printers.allBranches')),
          },
          {
            key: 'state',
            header: t('common.status'),
            cell: (a) =>
              a.online ? (
                <Badge tone="success">{t('printers.online')}</Badge>
              ) : (
                <Badge>{t('printers.offline')}</Badge>
              ),
          },
          {
            key: 'seen',
            header: t('printers.lastSeen'),
            hideBelow: 'md',
            cell: (a) => (a.lastSeenAt ? formatDateTime(a.lastSeenAt, i18n.language) : '—'),
          },
          {
            key: 'actions',
            header: <span className="sr-only">{t('common.actions')}</span>,
            cell: (a) => (
              <Button size="sm" variant="ghost" onClick={() => setRemoving(a)}>
                {t('printers.remove')}
              </Button>
            ),
          },
        ]}
      />
      {adding ? <AddPrinterDialog onClose={() => setAdding(false)} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('printers.removeTitle', { name: removing?.name ?? '' })}
        description={t('printers.removeHint')}
        confirmLabel={t('printers.remove')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </div>
  );
}

function AddPrinterDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const context = useBranchContext();
  const branches = context.branches.filter((b) => b.status === 'active');
  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState(context.branchId ?? '');
  const create = useMutation({
    mutationFn: () => api.printing.createAgent({ name: name.trim(), branchId: branchId || null }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: printersKey });
    },
    onError: notify.fail,
  });
  const token = create.data?.token;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('printers.add')}
      footer={
        token ? (
          <Button onClick={onClose}>{t('printers.done')}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!name.trim()}
              loading={create.isPending}
              onClick={() => create.mutate()}
            >
              {t('printers.create')}
            </Button>
          </>
        )
      }
    >
      {token ? (
        <div className="grid gap-3">
          <p className="text-sm">{t('printers.tokenOnce')}</p>
          <Input
            readOnly
            dir="ltr"
            aria-label={t('printers.token')}
            value={token}
            data-testid="print-agent-token"
            onFocus={(e) => e.target.select()}
          />
          <Button
            variant="secondary"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(token)
                .then(() => notify.ok(t('printers.copied')))
                .catch(() => undefined)
            }
          >
            {t('printers.copy')}
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          <Field label={t('common.name')} hint={t('printers.nameHint')}>
            {(p) => (
              <Input {...p} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field label={t('inventory.branch')} hint={t('printers.branchHint')}>
            {(p) => (
              <Select {...p} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">{t('printers.allBranches')}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {localizedName(b, i18n.language)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      )}
    </Dialog>
  );
}
