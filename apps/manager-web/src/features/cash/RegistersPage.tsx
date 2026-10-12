import type { Register } from '@arabat/contracts';
import { Money, MoneyError } from '@arabat/money';
import {
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
import { ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBranchContext, useBranchName, useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';

export const registersKey = ['manager', 'registers'] as const;

const validAmount = (v: string) => {
  try {
    Money.parse(v.trim() || '0', 'KWD');
    return true;
  } catch (error) {
    if (error instanceof MoneyError) return false;
    throw error;
  }
};

export function RegistersPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { branchId } = useBranchContext();
  const branchName = useBranchName();
  const [editing, setEditing] = useState<Register | 'new' | null>(null);
  const list = useQuery({
    queryKey: [...registersKey, branchId],
    queryFn: () => api.registers.list(branchId),
  });
  const status = useMutation({
    mutationFn: (r: Register) =>
      api.registers.setStatus(r.id, r.status === 'active' ? 'inactive' : 'active'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: registersKey });
      notify.ok(t('common.saved'));
    },
    onError: notify.fail,
  });
  return (
    <div>
      <PageHeader
        title={t('cash.registersTitle')}
        description={t('cash.registersSubtitle')}
        actions={<Button onClick={() => setEditing('new')}>{t('cash.newRegister')}</Button>}
      />
      <DataTable
        caption={t('cash.registersTitle')}
        loading={list.isPending}
        error={
          list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : null
        }
        rows={list.data?.registers}
        rowKey={(r) => r.id}
        onRowClick={setEditing}
        columns={[
          {
            key: 'name',
            header: t('common.name'),
            cell: (r) => (
              <span>
                <span className="block font-medium">{localizedName(r, i18n.language)}</span>
                <span className="block text-xs text-fg-muted" dir="ltr">
                  {r.code}
                </span>
              </span>
            ),
          },
          {
            key: 'branch',
            header: t('inventory.branch'),
            cell: (r) => branchName(r.branchId) ?? '—',
          },
          {
            key: 'access',
            header: t('cash.accessMode'),
            hideBelow: 'md',
            cell: (r) => t(`cash.access_${r.accessMode}`),
          },
          {
            key: 'float',
            header: t('cash.defaultFloat'),
            hideBelow: 'lg',
            cell: (r) => (
              <span dir="ltr" className="tabular-nums">
                {formatAmount(r.defaultOpeningFloat, i18n.language)}
              </span>
            ),
          },
          {
            key: 'state',
            header: t('common.status'),
            cell: (r) =>
              r.status !== 'active' ? (
                <Badge>{t('common.inactive')}</Badge>
              ) : r.openShift ? (
                <Badge tone="primary">
                  {t('cash.openShiftBy', { name: r.openShift.employeeName })}
                </Badge>
              ) : (
                <Badge tone="success">{t('cash.free')}</Badge>
              ),
          },
          {
            key: 'actions',
            header: <span className="sr-only">{t('common.actions')}</span>,
            cell: (r) => (
              <span onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="ghost" onClick={() => status.mutate(r)}>
                  {r.status === 'active' ? t('cash.deactivate') : t('cash.activate')}
                </Button>
              </span>
            ),
          },
        ]}
      />
      {editing ? (
        <RegisterDialog
          register={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function RegisterDialog({ register, onClose }: { register: Register | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const context = useBranchContext();
  const branches = context.branches.filter(
    (b) => b.status === 'active' || b.id === register?.branchId,
  );
  const [v, setV] = useState({
    branchId: register?.branchId ?? context.branchId ?? branches[0]?.id ?? '',
    code: register?.code ?? '',
    nameAr: register?.nameAr ?? '',
    nameEn: register?.nameEn ?? '',
    accessMode: register?.accessMode ?? ('branch' as Register['accessMode']),
    memberIds: register?.memberIds ?? ([] as string[]),
    defaultOpeningFloat: register?.defaultOpeningFloat.amount ?? '0.000',
    discrepancyTolerance: register?.discrepancyTolerance.amount ?? '0.000',
  });
  const employees = useQuery({
    queryKey: ['manager', 'employees'],
    queryFn: () => api.employees.list(),
    enabled: v.accessMode === 'restricted' && can('employees.read'),
  });
  const valid =
    Boolean(v.branchId) &&
    /^[A-Za-z0-9_-]{1,20}$/.test(v.code) &&
    Boolean(v.nameAr || v.nameEn) &&
    validAmount(v.defaultOpeningFloat) &&
    validAmount(v.discrepancyTolerance);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...v,
        nameAr: v.nameAr || null,
        nameEn: v.nameEn || null,
        defaultOpeningFloat: v.defaultOpeningFloat.trim() || '0',
        discrepancyTolerance: v.discrepancyTolerance.trim() || '0',
        memberIds: v.accessMode === 'restricted' ? v.memberIds : [],
      };
      return register
        ? api.registers.update(register.id, { ...body, version: register.version })
        : api.registers.create(body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: registersKey });
      notify.ok(t('common.saved'));
      onClose();
    },
    onError: notify.fail,
  });
  const toggleMember = (id: string, on: boolean) =>
    setV((c) => ({
      ...c,
      memberIds: on ? [...c.memberIds, id] : c.memberIds.filter((m) => m !== id),
    }));

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={register ? localizedName(register, i18n.language) : t('cash.newRegister')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('inventory.branch')}>
          {(p) => (
            <Select
              {...p}
              value={v.branchId}
              disabled={Boolean(register)}
              onChange={(e) => setV({ ...v, branchId: e.target.value })}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {localizedName(b, i18n.language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('cash.code')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              value={v.code}
              onChange={(e) => setV({ ...v, code: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('common.nameAr')}>
          {(p) => (
            <Input
              {...p}
              dir="rtl"
              value={v.nameAr}
              onChange={(e) => setV({ ...v, nameAr: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('common.nameEn')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              value={v.nameEn}
              onChange={(e) => setV({ ...v, nameEn: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('cash.defaultFloat')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              inputMode="decimal"
              value={v.defaultOpeningFloat}
              onChange={(e) => setV({ ...v, defaultOpeningFloat: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('cash.tolerance')} hint={t('cash.toleranceHint')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              inputMode="decimal"
              value={v.discrepancyTolerance}
              onChange={(e) => setV({ ...v, discrepancyTolerance: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('cash.accessMode')} className="sm:col-span-2">
          {(p) => (
            <Select
              {...p}
              value={v.accessMode}
              onChange={(e) => setV({ ...v, accessMode: e.target.value as Register['accessMode'] })}
            >
              <option value="branch">{t('cash.access_branch')}</option>
              <option value="restricted">{t('cash.access_restricted')}</option>
            </Select>
          )}
        </Field>
        {v.accessMode === 'restricted' ? (
          <fieldset className="grid gap-2 sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">{t('cash.members')}</legend>
            {employees.data?.employees
              .filter((e) => e.status === 'active')
              .map((e) => (
                <Checkbox
                  key={e.membershipId}
                  label={e.fullName}
                  description={e.email}
                  checked={v.memberIds.includes(e.membershipId)}
                  onChange={(ev) => toggleMember(e.membershipId, ev.target.checked)}
                />
              ))}
          </fieldset>
        ) : null}
      </div>
    </Dialog>
  );
}
