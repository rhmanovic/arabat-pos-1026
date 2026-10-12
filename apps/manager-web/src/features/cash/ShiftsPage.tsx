import type { DiscrepancyReport, ShiftListQuery } from '@arabat/contracts';
import { Money, MoneyError } from '@arabat/money';
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Section,
  Select,
  StatCard,
  Textarea,
} from '@arabat/ui';
import { ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useBranchContext, useBranchName, useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';
import { Pager } from '../inventory/shared.js';
import { CashTabs, OutcomeBadge } from './shared.js';

export const shiftsKey = ['manager', 'shifts'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function Amount({ value }: { value: { amount: string; currency: string } | null | undefined }) {
  const { i18n } = useTranslation();
  return (
    <span dir="ltr" className="tabular-nums">
      {formatAmount(value, i18n.language)}
    </span>
  );
}

export function ShiftsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'shifts' | 'report'>('shifts');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  return (
    <div>
      <PageHeader title={t('cash.shiftsTitle')} description={t('cash.shiftsSubtitle')} />
      <CashTabs
        tabs={[
          { key: 'shifts', label: t('cash.tabShifts') },
          { key: 'report', label: t('cash.tabDiscrepancies') },
        ]}
        active={tab}
        onChange={(k) => setTab(k as typeof tab)}
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm">
          {t('inventory.from')}
          <Input
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          {t('inventory.to')}
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {tab === 'shifts' ? (
        <ShiftList from={DATE.test(from) ? from : undefined} to={DATE.test(to) ? to : undefined} />
      ) : (
        <Report from={DATE.test(from) ? from : undefined} to={DATE.test(to) ? to : undefined} />
      )}
    </div>
  );
}

function ShiftList({ from, to }: { from: string | undefined; to: string | undefined }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const { branchId } = useBranchContext();
  const branchName = useBranchName();
  const [status, setStatus] = useState<'all' | 'open' | 'closed'>('all');
  const [outcome, setOutcome] = useState<'' | 'discrepancy' | 'balanced' | 'over' | 'short'>('');
  const filterKey = JSON.stringify([status, outcome, from, to, branchId]);
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const page = paging.key === filterKey ? paging.page : 1;
  const query: ShiftListQuery = {
    status,
    page,
    pageSize: 25,
    ...(outcome ? { outcome } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(branchId ? { branchId } : {}),
  };
  const list = useQuery({
    queryKey: [...shiftsKey, query],
    queryFn: () => api.shifts.list(query),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          className="max-w-40"
          aria-label={t('common.status')}
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="all">{t('cash.statusAll')}</option>
          <option value="open">{t('cash.status_open')}</option>
          <option value="closed">{t('cash.status_closed')}</option>
        </Select>
        <Select
          className="max-w-48"
          aria-label={t('cash.outcome')}
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as typeof outcome)}
        >
          <option value="">{t('cash.outcomeAll')}</option>
          <option value="discrepancy">{t('cash.outcomeDiscrepancy')}</option>
          <option value="balanced">{t('cash.outcome_balanced')}</option>
          <option value="over">{t('cash.outcome_over')}</option>
          <option value="short">{t('cash.outcome_short')}</option>
        </Select>
      </div>
      <DataTable
        caption={t('cash.shiftsTitle')}
        loading={list.isPending}
        error={
          list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : null
        }
        rows={list.data?.shifts}
        rowKey={(s) => s.id}
        empty={t('cash.shiftEmpty')}
        onRowClick={(s) => void navigate(`/shifts/${s.id}`)}
        columns={[
          {
            key: 'opened',
            header: t('cash.opened'),
            cell: (s) => formatDateTime(s.openedAt, i18n.language),
          },
          { key: 'employee', header: t('cash.employee'), cell: (s) => s.employeeName },
          {
            key: 'register',
            header: t('cash.register'),
            hideBelow: 'md',
            cell: (s) =>
              `${localizedName(s.registerName, i18n.language)} · ${branchName(s.branchId) ?? ''}`,
          },
          {
            key: 'expected',
            header: t('cash.expected'),
            hideBelow: 'sm',
            cell: (s) => <Amount value={s.summary.expectedCash} />,
          },
          {
            key: 'counted',
            header: t('cash.counted'),
            hideBelow: 'lg',
            cell: (s) => <Amount value={s.countedCash} />,
          },
          {
            key: 'diff',
            header: t('cash.discrepancy'),
            cell: (s) => <Amount value={s.discrepancy} />,
          },
          {
            key: 'outcome',
            header: t('cash.outcome'),
            cell: (s) => <OutcomeBadge outcome={s.outcome} />,
          },
        ]}
      />
      <Pager
        page={page}
        total={list.data?.total ?? 0}
        pageSize={25}
        onPage={(p) => setPaging({ key: filterKey, page: p })}
        label={t('inventory.count', { count: list.data?.total ?? 0 })}
      />
    </>
  );
}

function Report({ from, to }: { from: string | undefined; to: string | undefined }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { branchId } = useBranchContext();
  const branchName = useBranchName();
  const query = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(branchId ? { branchId } : {}),
  };
  const report = useQuery({
    queryKey: [...shiftsKey, 'report', query],
    queryFn: () => api.shifts.discrepancies(query),
  });
  const r = report.data;
  type Row = DiscrepancyReport['byEmployee'][number] | DiscrepancyReport['byRegister'][number];
  const columns = (name: (row: Row) => string) => [
    { key: 'name', header: t('common.name'), cell: name },
    { key: 'shifts', header: t('cash.totalShifts'), cell: (x: Row) => x.shifts },
    { key: 'short', header: t('cash.outcome_short'), cell: (x: Row) => x.short },
    {
      key: 'totalShort',
      header: t('cash.totalShort'),
      cell: (x: Row) => <Amount value={x.totalShort} />,
    },
    {
      key: 'totalOver',
      header: t('cash.totalOver'),
      hideBelow: 'sm' as const,
      cell: (x: Row) => <Amount value={x.totalOver} />,
    },
    { key: 'net', header: t('cash.net'), cell: (x: Row) => <Amount value={x.net} /> },
  ];
  return r ? (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('cash.totalShifts')} value={r.totals.shifts} />
        <StatCard
          label={t('cash.totalShort')}
          value={<Amount value={r.totals.totalShort} />}
          hint={`${r.totals.short} ${t('cash.outcome_short')}`}
        />
        <StatCard
          label={t('cash.totalOver')}
          value={<Amount value={r.totals.totalOver} />}
          hint={`${r.totals.over} ${t('cash.outcome_over')}`}
        />
        <StatCard
          label={t('cash.net')}
          value={<Amount value={r.totals.net} />}
          hint={
            r.totals.uncounted ? t('cash.uncountedHint', { count: r.totals.uncounted }) : undefined
          }
        />
      </div>
      <Section title={t('cash.byCloseType')}>
        <DataTable
          caption={t('cash.byCloseType')}
          rows={r.byCloseType}
          rowKey={(x) => x.closeType}
          columns={[
            {
              key: 'type',
              header: t('cash.closeTypeColumn'),
              cell: (x) => t(`cash.closeType_${x.closeType}`),
            },
            { key: 'shifts', header: t('cash.totalShifts'), cell: (x) => x.shifts },
            {
              key: 'net',
              header: t('cash.net'),
              cell: (x) =>
                x.closeType === 'forced_uncounted' ? t('cash.noCount') : <Amount value={x.net} />,
            },
          ]}
        />
      </Section>
      <Section title={t('cash.afterUncounted')}>
        <p className="mb-2 text-sm text-fg-muted">{t('cash.afterUncountedHint')}</p>
        <DataTable
          caption={t('cash.afterUncounted')}
          rows={r.afterUncounted}
          rowKey={(x) => `${x.shiftId}-${x.foundAt}`}
          empty={t('cash.noneFound')}
          columns={[
            { key: 'employee', header: t('cash.employee'), cell: (x) => x.employeeName },
            {
              key: 'register',
              header: t('cash.register'),
              cell: (x) => localizedName(x, i18n.language),
            },
            {
              key: 'found',
              header: t('cash.foundAt'),
              hideBelow: 'sm',
              cell: (x) =>
                new Date(x.foundAt).toLocaleString(i18n.language, { numberingSystem: 'latn' }),
            },
            {
              key: 'difference',
              header: t('cash.discrepancy'),
              cell: (x) => <Amount value={x.difference} />,
            },
          ]}
        />
      </Section>
      <Section title={t('cash.betweenShifts')}>
        <p className="mb-2 text-sm text-fg-muted">{t('cash.betweenShiftsHint')}</p>
        <DataTable
          caption={t('cash.betweenShifts')}
          rows={r.betweenShifts}
          rowKey={(x) => x.registerId}
          empty={t('cash.noneFound')}
          columns={[
            {
              key: 'register',
              header: t('cash.register'),
              cell: (x) => `${localizedName(x, i18n.language)} · ${branchName(x.branchId) ?? ''}`,
            },
            { key: 'openings', header: t('cash.openings'), cell: (x) => x.openings },
            { key: 'net', header: t('cash.net'), cell: (x) => <Amount value={x.net} /> },
          ]}
        />
      </Section>
      <Section title={t('cash.byEmployee')}>
        <DataTable
          caption={t('cash.byEmployee')}
          rows={r.byEmployee}
          rowKey={(x) => x.membershipId}
          columns={columns((x) => ('employeeName' in x ? x.employeeName : ''))}
        />
      </Section>
      <Section title={t('cash.byRegister')}>
        <DataTable
          caption={t('cash.byRegister')}
          rows={r.byRegister}
          rowKey={(x) => x.registerId}
          columns={columns((x) =>
            'registerId' in x
              ? `${localizedName(x, i18n.language)} · ${branchName(x.branchId) ?? ''}`
              : '',
          )}
        />
      </Section>
    </div>
  ) : null;
}

export function ShiftDetailPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { shiftId } = useParams();
  const { can } = useSession();
  const branchName = useBranchName();
  const [closing, setClosing] = useState(false);
  const shift = useQuery({
    queryKey: [...shiftsKey, 'detail', shiftId],
    queryFn: () => api.shifts.get(shiftId!),
  });
  const s = shift.data;
  return (
    <div>
      <PageHeader
        title={s ? `${t('cash.shiftTitle')} — ${s.employeeName}` : t('cash.shiftTitle')}
        description={
          s
            ? `${localizedName(s.registerName, i18n.language)} · ${branchName(s.branchId) ?? ''}`
            : undefined
        }
        actions={
          <div className="flex items-center gap-3">
            {s?.status === 'open' && can('registers.manage') ? (
              <Button variant="danger" onClick={() => setClosing(true)}>
                {t('cash.forceClose')}
              </Button>
            ) : null}
            <Link className="text-sm text-primary" to="/shifts">
              {t('common.back')}
            </Link>
          </div>
        }
      />
      {s ? (
        <div className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={t('cash.expected')}
              value={<Amount value={s.summary.expectedCash} />}
            />
            <StatCard label={t('cash.counted')} value={<Amount value={s.countedCash} />} />
            <StatCard
              label={t('cash.discrepancy')}
              value={<Amount value={s.discrepancy} />}
              hint={<OutcomeBadge outcome={s.outcome} />}
            />
            <StatCard
              label={t('cash.opened')}
              value={<span className="text-base">{formatDateTime(s.openedAt, i18n.language)}</span>}
              hint={
                s.closedAt
                  ? `${t('cash.closed')}: ${formatDateTime(s.closedAt, i18n.language)}`
                  : undefined
              }
            />
          </div>
          <Section title={t('cash.expected')}>
            <dl className="grid gap-3 text-sm sm:grid-cols-3" data-testid="shift-summary">
              {(
                [
                  ['openingFloat', s.summary.openingFloat],
                  ['cashIn', s.summary.cashIn],
                  ['cashOut', s.summary.cashOut],
                  ['cashSales', s.summary.cashSales],
                  ['cashRefunds', s.summary.cashRefunds],
                  ['expected', s.summary.expectedCash],
                ] as const
              ).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-fg-muted">{t(`cash.${key}`)}</dt>
                  <dd className="font-medium">
                    <Amount value={value} />
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-fg-muted">{t('cash.salesNote')}</p>
            {s.summary.openingExpected ? (
              <p className="mt-2 text-sm" data-testid="opening-count">
                {s.summary.openingIsInitial
                  ? t('cash.openingInitial')
                  : t('cash.openingCount', {
                      expected: formatAmount(s.summary.openingExpected, i18n.language),
                      counted: formatAmount(s.summary.openingFloat, i18n.language),
                      difference: formatAmount(s.summary.openingDiscrepancy, i18n.language),
                    })}
              </p>
            ) : null}
          </Section>
          {s.status === 'closed' ? (
            <Section title={t('cash.closed')}>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-fg-muted">{t('cash.closedBy')}</dt>
                  <dd>
                    {s.closedByName}
                    {s.closeType === 'forced' ? ` (${t('cash.forced')})` : ''}
                    {s.closeType === 'forced_uncounted' ? ` (${t('cash.forcedUncounted')})` : ''}
                  </dd>
                </div>
                {s.closingNote ? (
                  <div>
                    <dt className="text-fg-muted">{t('cash.note')}</dt>
                    <dd className="whitespace-pre-wrap">{s.closingNote}</dd>
                  </div>
                ) : null}
                {s.countedBreakdown?.length ? (
                  <div className="sm:col-span-2">
                    <dt className="text-fg-muted">{t('cash.breakdown')}</dt>
                    <dd dir="ltr" className="tabular-nums">
                      {s.countedBreakdown
                        .filter((d) => d.count > 0)
                        .map((d) => `${d.value} × ${d.count}`)
                        .join(' · ')}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </Section>
          ) : null}
          <Section title={t('cash.movements')}>
            <DataTable
              caption={t('cash.movements')}
              rows={s.movements}
              rowKey={(m) => m.id}
              empty={t('cash.noMovements')}
              columns={[
                {
                  key: 'date',
                  header: t('inventory.date'),
                  cell: (m) => formatDateTime(m.createdAt, i18n.language),
                },
                {
                  key: 'kind',
                  header: t('cash.kind'),
                  cell: (m) => (m.kind === 'cash_in' ? t('cash.cashIn') : t('cash.cashOut')),
                },
                {
                  key: 'amount',
                  header: t('catalog.price'),
                  cell: (m) => <Amount value={m.amount} />,
                },
                {
                  key: 'reason',
                  header: t('cash.reason'),
                  cell: (m) => t(`cash.reason_${m.reason}`),
                },
                {
                  key: 'note',
                  header: t('cash.note'),
                  hideBelow: 'md',
                  cell: (m) => m.note ?? '—',
                },
                {
                  key: 'by',
                  header: t('inventory.createdBy'),
                  hideBelow: 'lg',
                  cell: (m) => m.createdBy,
                },
              ]}
            />
          </Section>
        </div>
      ) : null}
      {closing && s ? (
        <ForceCloseDialog shiftId={s.id} version={s.version} onClose={() => setClosing(false)} />
      ) : null}
    </div>
  );
}

function ForceCloseDialog({
  shiftId,
  version,
  onClose,
}: {
  shiftId: string;
  version: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  // With a count the close is verified; without one it is «forced, uncounted» (ADR-0090).
  const [withCount, setWithCount] = useState(true);
  let valid = Boolean(note.trim());
  if (withCount)
    try {
      Money.parse(counted.trim(), 'KWD');
    } catch (error) {
      if (!(error instanceof MoneyError)) throw error;
      valid = false;
    }
  const close = useMutation({
    mutationFn: () =>
      api.shifts.forceClose(shiftId, {
        ...(withCount ? { countedCash: counted.trim() } : {}),
        note: note.trim(),
        version,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: shiftsKey });
      notify.ok(t('common.saved'));
      onClose();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('cash.forceCloseTitle')}
      description={t('cash.forceCloseHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={!valid}
            loading={close.isPending}
            onClick={() => close.mutate()}
          >
            {t('cash.forceClose')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={withCount}
            onChange={(e) => setWithCount(e.target.checked)}
          />
          {t('cash.forceWithCount')}
        </label>
        {withCount ? (
          <Field label={t('cash.counted')}>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                inputMode="decimal"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
              />
            )}
          </Field>
        ) : (
          <Alert tone="info">{t('cash.forceUncountedHint')}</Alert>
        )}
        <Field label={t('cash.note')}>
          {(p) => (
            <Textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
        <Alert tone="warning">{t('inventory.confirmBody')}</Alert>
      </div>
    </Dialog>
  );
}
