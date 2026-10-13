import { ApiError } from '@arabat/api-client';
import { ADJUSTMENT_REASONS, type AdjustmentKind, type StockLevel } from '@arabat/contracts';
import { QuantityError, formatQuantity, parseQuantity } from '@arabat/money';
import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
  Field,
  Input,
  PageHeader,
  Section,
  Select,
  Textarea,
} from '@arabat/ui';
import { localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useBranchContext, useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import { InventoryTabs, displayQty, inventoryKey, itemName } from './shared.js';

const KINDS: AdjustmentKind[] = ['increase', 'decrease', 'count', 'opening'];
const QTY = /^\d{1,11}(\.\d{1,3})?$/;
const AMOUNT = /^\d{1,10}(\.\d{1,3})?$/;

interface Line {
  item: StockLevel;
  quantity: string;
  unitCost: string;
}

function tryQty(value: string): bigint | null {
  try {
    return QTY.test(value.trim()) ? parseQuantity(value.trim()) : null;
  } catch (error) {
    if (error instanceof QuantityError) return null;
    throw error;
  }
}

/** Posts one stock document (append-only). Lines are added by searching the branch's stock. */
export function AdjustmentEditorPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [params] = useSearchParams();
  const context = useBranchContext();
  const branches = context.branches.filter((b) => b.status === 'active');
  const [chosenBranch, setBranchId] = useState<string>(context.branchId ?? '');
  // With a single branch there is nothing to choose.
  const branchId = chosenBranch || (branches.length === 1 ? branches[0]!.id : '');
  const [kind, setKind] = useState<AdjustmentKind>('increase');
  const [reason, setReason] = useState<string>(ADJUSTMENT_REASONS.increase[0]);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // One key per document: a retried submit can never post the adjustment twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  // Count sheets: when this sheet was opened. Stock that moves afterwards is reported by the
  // API and must be acknowledged before the count posts (BR-170).
  const [startedAt] = useState(() => new Date().toISOString());
  const [moved, setMoved] = useState<{ item: StockLevel; message: string }[] | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const withCost = (kind === 'opening' || kind === 'increase') && can('catalog.prices.manage');
  const policy = useQuery({
    queryKey: [...inventoryKey, 'settings'],
    queryFn: () => api.inventory.settings(),
  });
  // Blind counts (BR-170): the counter enters what is there without seeing the book figure.
  const blind = kind === 'count' && (policy.data?.blindStockCount ?? true);

  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  const results = useQuery({
    queryKey: [...inventoryKey, 'editor-search', branchId, q],
    enabled: Boolean(branchId) && q.length > 0,
    queryFn: () => api.inventory.levels({ branchId, q, pageSize: 10 }),
  });

  // Pre-filled from the stock list ("Adjust" on a row).
  const preset = params.get('variantId');
  useEffect(() => {
    if (!preset || !branchId) return;
    let cancelled = false;
    void api.inventory.variant(preset).then((v) => {
      if (cancelled) return;
      const onHand = v.branches.find((b) => b.branchId === branchId)?.onHand ?? '0.000';
      setLines((ls) =>
        ls.some((l) => l.item.variantId === v.variantId)
          ? ls
          : [
              ...ls,
              {
                item: {
                  variantId: v.variantId,
                  productId: v.productId,
                  nameEn: v.nameEn,
                  nameAr: v.nameAr,
                  variantNameEn: v.variantNameEn,
                  variantNameAr: v.variantNameAr,
                  sku: v.sku,
                  branchId,
                  onHand,
                  lowStockThreshold: null,
                  status: 'in_stock',
                  lastMovementAt: null,
                },
                quantity: '',
                unitCost: '',
              },
            ],
      );
    });
    return () => {
      cancelled = true;
    };
  }, [preset, branchId, api]);

  const changeKind = (next: AdjustmentKind) => {
    setKind(next);
    setReason(ADJUSTMENT_REASONS[next][0]);
  };
  const add = (item: StockLevel) => {
    if (!lines.some((l) => l.item.variantId === item.variantId))
      setLines((ls) => [...ls, { item, quantity: '', unitCost: '' }]);
    setSearch('');
    setQ('');
  };
  const update = (variantId: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.item.variantId === variantId ? { ...l, ...patch } : l)));

  const lineErrors = useMemo(
    () =>
      lines.map((l) => {
        const qty = tryQty(l.quantity);
        if (qty === null) return t('common:errors.INVALID_QUANTITY');
        if (kind !== 'count' && qty <= 0n) return t('common:errors.INVALID_QUANTITY');
        if (l.unitCost.trim() && !AMOUNT.test(l.unitCost.trim()))
          return t('common:errors.INVALID_PRICE');
        return null;
      }),
    [lines, kind, t],
  );
  const noteMissing = reason === 'other' && !note.trim();
  const valid =
    Boolean(branchId) && lines.length > 0 && lineErrors.every((e) => e === null) && !noteMissing;

  const post = useMutation({
    mutationFn: () =>
      api.inventory.createAdjustment({
        branchId,
        kind,
        reason,
        note: note.trim() || null,
        idempotencyKey,
        ...(kind === 'count' ? { startedAt, acknowledgeMovements: acknowledged } : {}),
        lines: lines.map((l) => ({
          variantId: l.item.variantId,
          quantity: l.quantity.trim(),
          unitCost: withCost && l.unitCost.trim() ? l.unitCost.trim() : null,
        })),
      }),
    onSuccess: async (adjustment) => {
      await queryClient.invalidateQueries({ queryKey: inventoryKey });
      notify.ok(
        t(adjustment.status === 'pending' ? 'inventory.sentForApproval' : 'inventory.posted'),
      );
      void navigate(`/inventory/adjustments/${adjustment.id}`, { replace: true });
    },
    onError: (error) => {
      setConfirm(false);
      if (error instanceof ApiError && error.code === 'STOCK_MOVED_SINCE_COUNT') {
        setMoved(
          (error.problem.issues ?? []).flatMap((issue) => {
            const index = Number(issue.path.split('.')[1]);
            const line = lines[index];
            return line ? [{ item: line.item, message: issue.message }] : [];
          }),
        );
        return;
      }
      notify.fail(error);
    },
  });

  const after = (l: Line) => {
    const qty = tryQty(l.quantity);
    if (qty === null) return '—';
    const base = parseQuantity(l.item.onHand);
    const next = kind === 'count' ? qty : kind === 'decrease' ? base - qty : base + qty;
    return displayQty(formatQuantity(next));
  };

  return (
    <div>
      <PageHeader
        title={t('inventory.newAdjustment')}
        description={t(`inventory.kindHint_${kind}`)}
      />
      <InventoryTabs />
      {branches.length === 0 ? <Alert tone="warning">{t('inventory.noBranches')}</Alert> : null}
      {policy.data && kind !== 'opening' ? (
        <p className="mb-4 text-sm text-fg-muted" data-testid="approval-limit">
          {t('inventory.approvalLimitHint', {
            amount: formatAmount(policy.data.adjustmentApprovalLimit, i18n.language),
          })}
        </p>
      ) : null}
      {blind ? <Alert tone="info">{t('inventory.blindCountHint')}</Alert> : null}
      {moved ? (
        <Alert tone="warning" title={t('inventory.movedTitle')}>
          <p className="text-sm">{t('inventory.movedBody')}</p>
          <ul className="my-2 list-disc ps-5 text-sm" data-testid="moved-items">
            {moved.map((m) => (
              <li key={m.item.variantId}>
                {itemName(m.item, i18n.language)}{' '}
                <span dir="ltr" className="text-fg-muted">
                  ({m.message})
                </span>
              </li>
            ))}
          </ul>
          <Checkbox
            label={t('inventory.acknowledgeMovements')}
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
        </Alert>
      ) : null}

      <div className="grid gap-6">
        <Section title={t('inventory.adjustmentTitle')}>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t('inventory.branch')}>
              {(p) => (
                <Select
                  {...p}
                  value={branchId}
                  onChange={(e) => {
                    // Quantities are per branch: start over for another branch.
                    setBranchId(e.target.value);
                    setLines([]);
                  }}
                >
                  <option value="">{t('inventory.chooseBranch')}</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {localizedName(b, i18n.language)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('inventory.kind')}>
              {(p) => (
                <Select
                  {...p}
                  value={kind}
                  onChange={(e) => changeKind(e.target.value as AdjustmentKind)}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`inventory.kind_${k}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('inventory.reason')}>
              {(p) => (
                <Select {...p} value={reason} onChange={(e) => setReason(e.target.value)}>
                  {ADJUSTMENT_REASONS[kind].map((r) => (
                    <option key={r} value={r}>
                      {t(`inventory.reason_${r}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              className="md:col-span-3"
              label={t('inventory.note')}
              error={submitted && noteMissing ? t('inventory.noteRequired') : undefined}
            >
              {(p) => (
                <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              )}
            </Field>
          </div>
        </Section>

        <Section title={t('inventory.lines')}>
          <div className="relative mb-4 max-w-md">
            <Input
              type="search"
              aria-label={t('inventory.addItems')}
              placeholder={t('inventory.addItemsPlaceholder')}
              disabled={!branchId}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {q && results.data ? (
              <ul
                className="absolute inset-x-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-surface shadow-lg"
                role="listbox"
                aria-label={t('inventory.addItems')}
              >
                {results.data.levels.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-fg-muted">{t('inventory.noMatches')}</li>
                ) : (
                  results.data.levels.map((item) => (
                    <li key={item.variantId}>
                      <button
                        type="button"
                        role="option"
                        aria-selected="false"
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-surface-muted"
                        onClick={() => add(item)}
                      >
                        <span>
                          {itemName(item, i18n.language)}
                          {item.sku ? (
                            <span className="ms-2 text-xs text-fg-muted" dir="ltr">
                              {item.sku}
                            </span>
                          ) : null}
                        </span>
                        {blind ? null : (
                          <span className="tabular-nums text-fg-muted" dir="ltr">
                            {displayQty(item.onHand)}
                          </span>
                        )}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>

          {lines.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('inventory.noLines')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {lines.map((l, i) => (
                <li
                  key={l.item.variantId}
                  className="grid items-end gap-3 py-3 sm:grid-cols-[1fr_8rem_8rem_auto] md:grid-cols-[1fr_6rem_8rem_8rem_6rem_auto]"
                  data-testid="adjustment-line"
                >
                  <div>
                    <p className="font-medium">{itemName(l.item, i18n.language)}</p>
                    {l.item.sku ? (
                      <p className="text-xs text-fg-muted" dir="ltr">
                        {l.item.sku}
                      </p>
                    ) : null}
                  </div>
                  <p className="text-sm max-md:hidden">
                    {blind ? null : (
                      <>
                        <span className="block text-xs text-fg-muted">
                          {t('inventory.current')}
                        </span>
                        <span className="tabular-nums" dir="ltr">
                          {displayQty(l.item.onHand)}
                        </span>
                      </>
                    )}
                  </p>
                  <Field
                    label={kind === 'count' ? t('inventory.counted') : t('inventory.quantity')}
                    error={submitted ? (lineErrors[i] ?? undefined) : undefined}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        inputMode="decimal"
                        dir="ltr"
                        value={l.quantity}
                        onChange={(e) => update(l.item.variantId, { quantity: e.target.value })}
                      />
                    )}
                  </Field>
                  {withCost ? (
                    <Field label={t('inventory.unitCost')}>
                      {(p) => (
                        <Input
                          {...p}
                          inputMode="decimal"
                          dir="ltr"
                          placeholder="0.000"
                          value={l.unitCost}
                          onChange={(e) => update(l.item.variantId, { unitCost: e.target.value })}
                        />
                      )}
                    </Field>
                  ) : (
                    <span className="max-md:hidden" />
                  )}
                  <p className="text-sm">
                    {blind ? null : (
                      <>
                        <span className="block text-xs text-fg-muted">{t('inventory.after')}</span>
                        <span className="font-semibold tabular-nums" dir="ltr" data-testid="after">
                          {after(l)}
                        </span>
                      </>
                    )}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setLines((ls) => ls.filter((x) => x.item.variantId !== l.item.variantId))
                    }
                  >
                    {t('inventory.remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {withCost ? (
            <p className="mt-2 text-xs text-fg-muted">{t('inventory.unitCostHint')}</p>
          ) : null}
        </Section>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => void navigate('/inventory')}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!branchId || lines.length === 0 || (moved !== null && !acknowledged)}
            onClick={() => {
              setSubmitted(true);
              if (valid) setConfirm(true);
            }}
          >
            {t('inventory.submit')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('inventory.confirmTitle')}
        description={t('inventory.confirmBody')}
        confirmLabel={t('inventory.submit')}
        cancelLabel={t('common.cancel')}
        loading={post.isPending}
        onConfirm={() => post.mutate()}
      />
    </div>
  );
}
