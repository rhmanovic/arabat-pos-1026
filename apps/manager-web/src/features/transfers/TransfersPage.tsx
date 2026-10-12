import { TRANSFER_STATUSES, type Transfer, type TransferStatus } from '@arabat/contracts';
import { QuantityError, parseQuantity } from '@arabat/money';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Section,
  Select,
  Textarea,
} from '@arabat/ui';
import { ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useBranchContext, useBranchName, useSession } from '../../app/context.js';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';
import { Pager, displayQty, itemName } from '../inventory/shared.js';
import { ItemPicker } from '../purchasing/ItemPicker.js';

export const transfersKey = ['manager', 'transfers'] as const;
const TONE: Record<TransferStatus, 'neutral' | 'warning' | 'primary' | 'success' | 'danger'> = {
  requested: 'warning',
  approved: 'primary',
  in_transit: 'primary',
  received: 'success',
  cancelled: 'danger',
};
const QTY = /^\d{1,11}(\.\d{1,3})?$/;

function qtyOk(v: string) {
  try {
    return QTY.test(v.trim()) && parseQuantity(v.trim()) >= 0n;
  } catch (error) {
    if (error instanceof QuantityError) return false;
    throw error;
  }
}

function StatusBadge({ status }: { status: TransferStatus }) {
  const { t } = useTranslation();
  return <Badge tone={TONE[status]}>{t(`transfers.status_${status}`)}</Badge>;
}

export function TransfersPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const { can } = useSession();
  const { branchId } = useBranchContext();
  const branchName = useBranchName();
  const [status, setStatus] = useState<TransferStatus | ''>('');
  const filterKey = JSON.stringify([status, branchId]);
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const page = paging.key === filterKey ? paging.page : 1;
  const query = {
    page,
    pageSize: 25,
    ...(status ? { status } : {}),
    ...(branchId ? { branchId } : {}),
  };
  const list = useQuery({
    queryKey: [...transfersKey, query],
    queryFn: () => api.transfers.list(query),
    placeholderData: keepPreviousData,
  });
  type Row = NonNullable<typeof list.data>['transfers'][number];
  return (
    <div>
      <PageHeader
        title={t('transfers.title')}
        description={t('transfers.subtitle')}
        actions={
          can('inventory.transfer') ? (
            <Button onClick={() => void navigate('/transfers/new')}>
              {t('transfers.newTransfer')}
            </Button>
          ) : null
        }
      />
      <div className="mb-4">
        <Select
          className="max-w-52"
          aria-label={t('transfers.status')}
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="">{t('transfers.allStatuses')}</option>
          {TRANSFER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`transfers.status_${s}`)}
            </option>
          ))}
        </Select>
      </div>
      <DataTable<Row>
        caption={t('transfers.title')}
        loading={list.isPending}
        error={
          list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : null
        }
        rows={list.data?.transfers}
        rowKey={(r) => r.id}
        empty={t('transfers.empty')}
        onRowClick={(r) => void navigate(`/transfers/${r.id}`)}
        columns={[
          {
            key: 'number',
            header: t('transfers.number'),
            cell: (r) => (
              <span dir="ltr" className="font-medium">
                {r.number}
              </span>
            ),
          },
          {
            key: 'from',
            header: t('transfers.from'),
            cell: (r) => branchName(r.sourceBranchId) ?? '—',
          },
          {
            key: 'to',
            header: t('transfers.to'),
            cell: (r) => branchName(r.destinationBranchId) ?? '—',
          },
          {
            key: 'date',
            header: t('inventory.date'),
            hideBelow: 'md',
            cell: (r) => formatDateTime(r.createdAt, i18n.language),
          },
          {
            key: 'missing',
            header: t('transfers.missing'),
            hideBelow: 'lg',
            cell: (r) =>
              r.discrepancyQuantity !== '0.000' ? (
                <span dir="ltr" className="text-danger">
                  {displayQty(r.discrepancyQuantity)}
                </span>
              ) : (
                '—'
              ),
          },
          {
            key: 'status',
            header: t('transfers.status'),
            cell: (r) => <StatusBadge status={r.status} />,
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
    </div>
  );
}

export function NewTransferPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const context = useBranchContext();
  const branches = context.branches.filter((b) => b.status === 'active');
  const [source, setSource] = useState(branches[0]?.id ?? '');
  const [destination, setDestination] = useState(branches[1]?.id ?? '');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<
    { variantId: string; label: string; available: string; quantity: string }[]
  >([]);
  const valid =
    source &&
    destination &&
    source !== destination &&
    lines.length > 0 &&
    lines.every((l) => qtyOk(l.quantity) && parseQuantity(l.quantity.trim()) > 0n);
  const create = useMutation({
    mutationFn: () =>
      api.transfers.create({
        sourceBranchId: source,
        destinationBranchId: destination,
        note: note.trim() || null,
        lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity.trim() })),
      }),
    onSuccess: async (tr) => {
      await queryClient.invalidateQueries({ queryKey: transfersKey });
      notify.ok(t('transfers.created'));
      void navigate(`/transfers/${tr.id}`, { replace: true });
    },
    onError: notify.fail,
  });
  return (
    <div>
      <PageHeader title={t('transfers.newTransfer')} description={t('transfers.subtitle')} />
      <div className="grid gap-6">
        <Section title={t('transfers.title')}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('transfers.from')}>
              {(p) => (
                <Select
                  {...p}
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value);
                    setLines([]);
                  }}
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {localizedName(b, i18n.language)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('transfers.to')}>
              {(p) => (
                <Select {...p} value={destination} onChange={(e) => setDestination(e.target.value)}>
                  <option value="" />
                  {branches
                    .filter((b) => b.id !== source)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {localizedName(b, i18n.language)}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field label={t('transfers.note')} className="md:col-span-2">
              {(p) => (
                <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              )}
            </Field>
          </div>
        </Section>
        <Section title={t('transfers.item')}>
          <div className="mb-3">
            <ItemPicker
              branchId={source}
              label={t('transfers.addItem')}
              onPick={(item) =>
                setLines((ls) =>
                  ls.some((l) => l.variantId === item.variantId)
                    ? ls
                    : [
                        ...ls,
                        {
                          variantId: item.variantId,
                          label: itemName(item, i18n.language),
                          available: item.onHand,
                          quantity: '1',
                        },
                      ],
                )
              }
            />
          </div>
          <ul className="divide-y divide-border">
            {lines.map((l, i) => (
              <li
                key={l.variantId}
                className="grid items-end gap-3 py-2 sm:grid-cols-[1fr_8rem_8rem_auto]"
                data-testid="transfer-line"
              >
                <span className="font-medium">{l.label}</span>
                <span className="text-sm">
                  <span className="block text-xs text-fg-muted">{t('transfers.available')}</span>
                  <span dir="ltr">{displayQty(l.available)}</span>
                </span>
                <Field label={t('transfers.requested')}>
                  {(p) => (
                    <Input
                      {...p}
                      dir="ltr"
                      inputMode="decimal"
                      value={l.quantity}
                      onChange={(e) =>
                        setLines((ls) =>
                          ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)),
                        )
                      }
                    />
                  )}
                </Field>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                >
                  {t('inventory.remove')}
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end">
            <Button disabled={!valid} loading={create.isPending} onClick={() => create.mutate()}>
              {t('transfers.create')}
            </Button>
          </div>
        </Section>
      </div>
    </div>
  );
}

export function TransferDetailPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const branchName = useBranchName();
  const { transferId } = useParams();
  const transfer = useQuery({
    queryKey: [...transfersKey, 'detail', transferId],
    queryFn: () => api.transfers.get(transferId!),
  });
  const [dialog, setDialog] = useState<'dispatch' | 'receive' | null>(null);
  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: transfersKey });
    notify.ok(t('transfers.updated'));
  };
  const action = useMutation({
    mutationFn: (a: 'approve' | 'cancel') =>
      api.transfers.action(transferId!, a, transfer.data!.version),
    onSuccess: done,
    onError: notify.fail,
  });
  const tr = transfer.data;
  return (
    <div>
      <PageHeader
        title={tr ? `${t('transfers.title')} ${tr.number}` : t('transfers.title')}
        description={
          tr
            ? `${branchName(tr.sourceBranchId) ?? ''} → ${branchName(tr.destinationBranchId) ?? ''}`
            : undefined
        }
        actions={
          tr ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={tr.status} />
              {tr.status === 'requested' && can('inventory.transfer.approve') ? (
                <Button loading={action.isPending} onClick={() => action.mutate('approve')}>
                  {t('transfers.approve')}
                </Button>
              ) : null}
              {tr.status === 'approved' && can('inventory.transfer') ? (
                <Button onClick={() => setDialog('dispatch')}>{t('transfers.dispatch')}</Button>
              ) : null}
              {tr.status === 'in_transit' && can('inventory.transfer') ? (
                <Button onClick={() => setDialog('receive')}>{t('transfers.receive')}</Button>
              ) : null}
              {['requested', 'approved'].includes(tr.status) ? (
                <Button
                  variant="ghost"
                  loading={action.isPending}
                  onClick={() => action.mutate('cancel')}
                >
                  {t('transfers.cancel')}
                </Button>
              ) : null}
              <Link className="text-sm text-primary" to="/transfers">
                {t('common.back')}
              </Link>
            </div>
          ) : null
        }
      />
      {tr ? (
        <div className="grid gap-6">
          {tr.status === 'in_transit' ? (
            <Alert tone="info">{t('transfers.inTransitHint')}</Alert>
          ) : null}
          <DataTable<Transfer['lines'][number]>
            caption={t('transfers.item')}
            rows={tr.lines}
            rowKey={(l) => String(l.position)}
            columns={[
              { key: 'item', header: t('transfers.item'), cell: (l) => itemName(l, i18n.language) },
              {
                key: 'requested',
                header: t('transfers.requested'),
                cell: (l) => <span dir="ltr">{displayQty(l.requestedQuantity)}</span>,
              },
              {
                key: 'dispatched',
                header: t('transfers.dispatched'),
                cell: (l) => <span dir="ltr">{displayQty(l.dispatchedQuantity)}</span>,
              },
              {
                key: 'received',
                header: t('transfers.received'),
                cell: (l) => <span dir="ltr">{displayQty(l.receivedQuantity)}</span>,
              },
              {
                key: 'missing',
                header: t('transfers.missing'),
                cell: (l) =>
                  l.discrepancyQuantity && l.discrepancyQuantity !== '0.000' ? (
                    <span
                      dir="ltr"
                      className="font-semibold text-danger"
                      data-testid="line-missing"
                    >
                      {displayQty(l.discrepancyQuantity)}
                    </span>
                  ) : (
                    '—'
                  ),
              },
            ]}
          />
          <Section title={t('transfers.title')}>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-fg-muted">{t('transfers.requestedBy')}</dt>
                <dd>
                  {tr.requestedBy} · {formatDateTime(tr.createdAt, i18n.language)}
                </dd>
              </div>
              {tr.approvedBy ? (
                <div>
                  <dt className="text-fg-muted">{t('transfers.approvedBy')}</dt>
                  <dd>{tr.approvedBy}</dd>
                </div>
              ) : null}
              {tr.dispatchedBy ? (
                <div>
                  <dt className="text-fg-muted">{t('transfers.dispatchedBy')}</dt>
                  <dd>
                    {tr.dispatchedBy} · {formatDateTime(tr.dispatchedAt!, i18n.language)}
                  </dd>
                </div>
              ) : null}
              {tr.receivedBy ? (
                <div>
                  <dt className="text-fg-muted">{t('transfers.receivedBy')}</dt>
                  <dd>
                    {tr.receivedBy} · {formatDateTime(tr.receivedAt!, i18n.language)}
                  </dd>
                </div>
              ) : null}
              {tr.discrepancyNote ? (
                <div className="sm:col-span-2">
                  <dt className="text-fg-muted">{t('transfers.discrepancyNote')}</dt>
                  <dd>{tr.discrepancyNote}</dd>
                </div>
              ) : null}
            </dl>
          </Section>
        </div>
      ) : null}
      {dialog && tr ? (
        <QuantitiesDialog
          transfer={tr}
          mode={dialog}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
    </div>
  );
}

function QuantitiesDialog({
  transfer,
  mode,
  onClose,
  onDone,
}: {
  transfer: Transfer;
  mode: 'dispatch' | 'receive';
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const base = (l: Transfer['lines'][number]) =>
    displayQty(mode === 'dispatch' ? l.requestedQuantity : (l.dispatchedQuantity ?? '0'));
  const [qty, setQty] = useState<Record<number, string>>(
    Object.fromEntries(transfer.lines.map((l) => [l.position, base(l)])),
  );
  const [note, setNote] = useState('');
  const short =
    mode === 'receive' &&
    transfer.lines.some(
      (l) =>
        qtyOk(qty[l.position] ?? '') &&
        parseQuantity(qty[l.position]!.trim()) < parseQuantity(l.dispatchedQuantity ?? '0'),
    );
  const valid =
    transfer.lines.every((l) => qtyOk(qty[l.position] ?? '')) && (!short || Boolean(note.trim()));
  const run = useMutation({
    mutationFn: () => {
      const body = {
        version: transfer.version,
        note: note.trim() || null,
        lines: transfer.lines.map((l) => ({
          position: l.position,
          quantity: qty[l.position]!.trim(),
        })),
      };
      return mode === 'dispatch'
        ? api.transfers.dispatch(transfer.id, body)
        : api.transfers.receive(transfer.id, body);
    },
    onSuccess: async () => {
      await onDone();
      onClose();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={mode === 'dispatch' ? t('transfers.dispatchTitle') : t('transfers.receiveTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!valid} loading={run.isPending} onClick={() => run.mutate()}>
            {mode === 'dispatch' ? t('transfers.dispatch') : t('transfers.receive')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {transfer.lines.map((l) => (
          <div key={l.position} className="grid items-end gap-3 sm:grid-cols-[1fr_8rem]">
            <span>{itemName(l, i18n.language)}</span>
            <Field
              label={mode === 'dispatch' ? t('transfers.dispatched') : t('transfers.received')}
            >
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  inputMode="decimal"
                  value={qty[l.position] ?? ''}
                  onChange={(e) => setQty((q) => ({ ...q, [l.position]: e.target.value }))}
                />
              )}
            </Field>
          </div>
        ))}
        {short ? (
          <Field label={t('transfers.discrepancy')}>
            {(p) => (
              <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            )}
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}
