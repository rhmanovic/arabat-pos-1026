import type { PeriodList, PeriodPack, PeriodSummary, closePeriodSchema } from '@arabat/contracts';
import { Money, formatQuantity } from '@arabat/money';
import { permissionBranchScope } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import {
  addDays,
  dayEnd,
  merchantTimezone,
  todayIn,
  withinLocalDays,
} from '../../kernel/time/period.js';
import { AuditService } from '../audit/audit.service.js';
import { countOpenVariances } from '../cash/cash-controls.service.js';
import { ReportsService } from '../reports/reports.service.js';
import { periodCloses } from './periods.schema.js';

type CloseInput = z.output<typeof closePeriodSchema>;
type Row = Record<string, unknown>;

const CURRENCY = 'KWD' as const;
const money = (minor: bigint | string | null | undefined) =>
  Money.ofMinor(BigInt(minor ?? 0), CURRENCY).toJSON();
const big = (v: unknown) => BigInt((v as string | number | null) ?? 0);
const int = (v: unknown) => Number(v ?? 0);
const minorOf = (m: { amount: string }) => Money.parse(m.amount, CURRENCY).minor;

/** 'YYYY-MM' → first and last local day. */
export function monthBounds(period: string): { from: string; to: string } {
  const from = `${period}-01`;
  const [y, m] = period.split('-').map(Number) as [number, number];
  const nextFirst = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  return { from, to: addDays(nextFirst, -1) };
}
const monthOf = (date: string) => date.slice(0, 7);
const nextMonth = (period: string) => monthOf(addDays(monthBounds(period).to, 1));

/**
 * The lock of closed periods (BR-189): a document dated inside a closed month is refused.
 * Called by every service that accepts a business date (purchase orders, receipts).
 */
export async function assertPeriodOpen(tx: Transaction, merchantId: string, date: string) {
  const [closed] = (
    await tx.execute(sql`select period from period_closes
      where merchant_id = ${merchantId} and from_date <= ${date}::date and to_date >= ${date}::date`)
  ).rows as { period: string }[];
  if (closed)
    throw new AppError(
      409,
      'PERIOD_CLOSED',
      `${closed.period} is closed; documents dated in it can no longer be recorded.`,
    );
}

/**
 * Period close (BR-189, remediation R4.2): months close in order, once, with a stored pack of
 * the figures an external accountant needs; an open month shows the same pack computed live.
 */
@Injectable()
export class PeriodsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: MerchantActor): Promise<PeriodList> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const tz = await merchantTimezone(tx, actor.merchantId);
      const today = todayIn(tz);
      const firstMonth = await this.firstMonth(tx, actor.merchantId, tz);
      const closes = await this.closes(tx);
      const latestClosed = [...closes.keys()].sort().at(-1) ?? null;
      const periods: PeriodSummary[] = [];
      for (let p = firstMonth; p <= monthOf(today); p = nextMonth(p)) {
        const { from, to } = monthBounds(p);
        const closed = closes.get(p);
        periods.push({
          period: p,
          from,
          to,
          status: closed
            ? 'closed'
            : to >= today
              ? 'current'
              : this.closable(p, latestClosed, firstMonth)
                ? 'closable'
                : 'open',
          closedAt: closed?.closedAt ?? null,
          closedBy: closed?.closedBy ?? null,
          note: closed?.note ?? null,
        });
      }
      return { timezone: tz, periods: periods.reverse() };
    });
  }

  async get(actor: MerchantActor, period: string): Promise<PeriodPack> {
    const stored = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const closes = await this.closes(tx);
      const closed = closes.get(period);
      if (!closed) return null;
      return {
        ...(closed.pack as Omit<PeriodPack, 'status' | 'closedAt' | 'closedBy' | 'note'>),
        status: 'closed' as const,
        closedAt: closed.closedAt,
        closedBy: closed.closedBy,
        note: closed.note,
      };
    });
    if (stored) return stored;
    const { pack, status } = await this.compute(actor, period);
    return { ...pack, status, closedAt: null, closedBy: null, note: null };
  }

  async close(
    actor: MerchantActor,
    period: string,
    input: CloseInput,
    ip: string,
  ): Promise<PeriodPack> {
    const { pack, status } = await this.compute(actor, period);
    if (status !== 'closable')
      throw new AppError(
        409,
        'PERIOD_NOT_CLOSABLE',
        status === 'closed'
          ? `${period} is already closed.`
          : status === 'current'
            ? `${period} has not ended yet.`
            : `An earlier month is still open; close the months in order.`,
      );
    const id = newId();
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      // Re-check under the unique key: two closers of the same month cannot both win.
      await assertPeriodOpenMonth(tx, actor.merchantId, period);
      await tx.insert(periodCloses).values({
        id,
        merchantId: actor.merchantId,
        period,
        fromDate: pack.from,
        toDate: pack.to,
        timezone: pack.timezone,
        closedByUserId: actor.userId,
        note: input.note,
        pack,
      });
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'period.closed',
        targetType: 'period_close',
        targetId: id,
        ip,
        details: {
          period,
          from: pack.from,
          to: pack.to,
          netSales: pack.sales.netSales.amount,
          refunds: pack.sales.refunds.amount,
          cashOnHand: pack.cash.total.amount,
          closingStockValue: pack.stock.closingValue.amount,
          note: input.note,
        },
      });
    });
    return this.get(actor, period);
  }

  // ------------------------------------------------------------ internals
  /** Months close in order, starting with the month the company was registered in. */
  private closable(period: string, latestClosed: string | null, firstMonth: string): boolean {
    return latestClosed === null ? period === firstMonth : period === nextMonth(latestClosed);
  }

  /** The month of the company's registration in its time zone. */
  private async firstMonth(tx: Transaction, merchantId: string, tz: string): Promise<string> {
    const [m] = (await tx.execute(sql`select created_at from merchants where id = ${merchantId}`))
      .rows as { created_at: Date | string }[];
    return monthOf(todayIn(tz, new Date(m!.created_at)));
  }

  private async closes(tx: Transaction) {
    const rows = (
      await tx.execute(sql`select c.period, c.note, c.pack, c.created_at, u.full_name
        from period_closes c join users u on u.id = c.closed_by_user_id`)
    ).rows as Row[];
    return new Map(
      rows.map((r) => [
        String(r['period']).trim(),
        {
          note: (r['note'] as string | null) ?? null,
          pack: r['pack'],
          closedAt: new Date(r['created_at'] as string).toISOString(),
          closedBy: r['full_name'] as string,
        },
      ]),
    );
  }

  /** The closer needs every report for the whole company: a pack is never partial. */
  private assertFullScope(actor: MerchantActor) {
    for (const p of ['reports.sales', 'reports.financial', 'reports.inventory'] as const)
      if (!permissionBranchScope(actor.access, p).all) throw AppError.forbidden();
  }

  private async compute(
    actor: MerchantActor,
    period: string,
  ): Promise<{
    pack: Omit<PeriodPack, 'status' | 'closedAt' | 'closedBy' | 'note'>;
    status: PeriodSummary['status'];
  }> {
    this.assertFullScope(actor);
    const { from, to } = monthBounds(period);
    const q = { from, to };
    const sales = await this.reports.sales(actor, q);
    const payments = await this.reports.payments(actor, q);
    const inventory = await this.reports.inventory(actor, q);
    const rest = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const tz = await merchantTimezone(tx, actor.merchantId);
      const today = todayIn(tz);
      const closes = await this.closes(tx);
      const latestClosed = [...closes.keys()].sort().at(-1) ?? null;
      const firstMonth = await this.firstMonth(tx, actor.merchantId, tz);
      const status: PeriodSummary['status'] = closes.has(period)
        ? 'closed'
        : to >= today
          ? 'current'
          : this.closable(period, latestClosed, firstMonth)
            ? 'closable'
            : 'open';
      const end = dayEnd(tz, to);
      const rows = async (query: ReturnType<typeof sql>) => (await tx.execute(query)).rows as Row[];
      // Cash by place as at the end of the month (ADR-0090): the ledger up to the cut-off.
      const places = await rows(sql`
        select a.id, a.kind, a.branch_id, a.name_en, a.name_ar,
               coalesce((select sum(e.amount_minor) from financial_account_entries e
                         where e.account_id = a.id and e.created_at < ${end}), 0)::text as balance
        from financial_accounts a join branches b on b.id = a.branch_id
        where a.kind in ('treasury', 'register')
        order by b.is_main desc, b.name_en nulls last, a.kind, a.name_en`);
      const [transit] = await rows(sql`select coalesce(sum(t.amount_sent_minor), 0)::text as total
        from cash_branch_transfers t where t.status = 'in_transit'`);
      const [deposits] = await rows(sql`select coalesce(sum(t.amount_minor), 0)::text as total
        from cash_transfers t join financial_accounts d on d.id = t.to_account_id
        where d.kind = 'deposit_transit'
          and not exists (select 1 from cash_transfers c where c.confirms_transfer_id = t.id)`);
      const [owed] =
        await rows(sql`select count(*)::int as n, coalesce(sum(total_minor), 0)::text as amount
        from refunds where status in ('pending_approval', 'processing')`);
      const [adjustments] = await rows(
        sql`select count(*)::int as n from stock_adjustments where status = 'pending'`,
      );
      const [payouts] = await rows(
        sql`select count(*)::int as n from cash_payout_requests where status = 'pending'`,
      );
      const [movements] = await rows(sql`select count(*)::int as n from cash_movements m
        join shifts s on s.id = m.shift_id where m.status = 'pending' and s.status = 'open'`);
      const [losses] = await rows(
        sql`select count(*)::int as n from stock_transfer_losses where status = 'pending'`,
      );
      const [held] = await rows(
        sql`select count(*)::int as n from orders where status = 'suspended'`,
      );
      const variances = await countOpenVariances(tx, actor.merchantId);
      // Suppliers: received at order cost − paid, cumulative to the end of the month (BR-188).
      const [received] = await rows(sql`
        select coalesce(sum(round(rl.quantity * ol.unit_cost_minor)), 0)::text as value
        from purchase_receipt_lines rl
        join purchase_receipts rc on rc.id = rl.receipt_id
        join purchase_order_lines ol on ol.purchase_order_id = rc.purchase_order_id and ol.position = rl.order_position
        where rc.created_at < ${end}`);
      const [paid] = await rows(sql`
        select coalesce(sum(case when d.reverses_id is null then d.amount_minor else -d.amount_minor end), 0)::text as net
        from cash_disbursements d where d.kind = 'supplier_payment' and d.created_at < ${end}`);
      const within = (col: ReturnType<typeof sql>) => withinLocalDays(tz, col, from, to);
      const [docs] = await rows(sql`
        select (select count(*) from sales s where ${within(sql`s.created_at`)})::int as sales,
               (select count(*) from refunds r where r.status = 'completed' and ${within(sql`r.completed_at`)})::int as refunds,
               (select count(*) from purchase_receipts rc where rc.received_on between ${from}::date and ${to}::date)::int as receipts,
               (select count(*) from cash_disbursements d where ${within(sql`d.created_at`)})::int as disbursements,
               (select count(*) from purchase_orders o where o.status <> 'draft' and o.status <> 'cancelled'
                  and o.document_date between ${from}::date and ${to}::date)::int as purchase_orders`);
      return {
        tz,
        status,
        places,
        transit: big(transit?.['total']),
        deposits: big(deposits?.['total']),
        owed: { count: int(owed?.['n']), amount: big(owed?.['amount']) },
        open: {
          variances,
          pendingAdjustments: int(adjustments?.['n']),
          pendingPayoutRequests: int(payouts?.['n']),
          pendingCashMovements: int(movements?.['n']),
          pendingTransferLosses: int(losses?.['n']),
          heldSales: int(held?.['n']),
        },
        suppliers: { received: big(received?.['value']), paid: big(paid?.['net']) },
        docs: docs!,
      };
    });
    const treasuries = rest.places.filter((p) => p['kind'] === 'treasury');
    const registers = rest.places.filter((p) => p['kind'] === 'register');
    const sum = (xs: Row[]) => xs.reduce((s, r) => s + big(r['balance']), 0n);
    const treasuriesTotal = sum(treasuries);
    const registersTotal = sum(registers);
    const pack = {
      period,
      from,
      to,
      timezone: rest.tz,
      computedAt: new Date().toISOString(),
      sales: {
        saleCount: sales.summary.saleCount,
        gross: sales.summary.gross,
        discounts: sales.summary.discounts,
        netSales: sales.summary.netSales,
        refundCount: sales.summary.refundCount,
        refunds: sales.summary.refunds,
        netAfterRefunds: sales.summary.netAfterRefunds,
      },
      profit: sales.profit
        ? {
            available: sales.profit.available,
            costOfSales: sales.profit.costOfSales ?? money(0n),
            grossProfit: sales.profit.grossProfit ?? money(0n),
            marginPercent: sales.profit.marginPercent,
            uncostedSales: sales.profit.uncostedSales,
          }
        : null,
      collections: payments.collections.map((c) => ({
        kind: c.kind,
        methodId: c.methodId,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        collected: c.collected,
        fees: c.fees,
        feesReversed: c.feesReversed,
        refunded: c.refunded,
        net: c.net,
      })),
      collectionTotals: {
        collected: payments.totals.collected,
        fees: payments.totals.fees,
        feesReversed: payments.totals.feesReversed,
        refunded: payments.totals.refunded,
        netAfterFees: payments.totals.netAfterFees,
      },
      unreferencedTenders: {
        count: payments.unreferenced.count,
        amount: payments.unreferenced.amount,
      },
      cash: {
        places: rest.places
          .filter((p) => p['kind'] === 'treasury' || big(p['balance']) !== 0n)
          .map((p) => ({
            accountId: p['id'] as string,
            kind: p['kind'] as 'treasury' | 'register',
            branchId: p['branch_id'] as string,
            nameEn: (p['name_en'] as string | null) ?? null,
            nameAr: (p['name_ar'] as string | null) ?? null,
            balance: money(big(p['balance'])),
          })),
        treasuriesTotal: money(treasuriesTotal),
        registersTotal: money(registersTotal),
        inTransitTotal: money(rest.transit),
        depositsInTransitTotal: money(rest.deposits),
        total: money(treasuriesTotal + registersTotal + rest.transit),
      },
      stock: {
        closingQuantity: formatQuantity(
          BigInt(Math.round(Number(inventory.asAt.total.quantity) * 1000)),
        ),
        closingValue: inventory.asAt.total.value,
        unvaluedItems: inventory.unvalued.length,
        inTransit: inventory.inTransit,
      },
      refundsOwed: { count: rest.owed.count, amount: money(rest.owed.amount) },
      open: {
        variances: rest.open.variances,
        transfersInTransit: inventory.inTransit.transfers,
        pendingRefunds: rest.owed.count,
        pendingAdjustments: rest.open.pendingAdjustments,
        pendingPayoutRequests: rest.open.pendingPayoutRequests,
        pendingCashMovements: rest.open.pendingCashMovements,
        pendingTransferLosses: rest.open.pendingTransferLosses,
        heldSales: rest.open.heldSales,
      },
      suppliers: {
        received: money(rest.suppliers.received),
        paid: money(rest.suppliers.paid),
        balance: money(rest.suppliers.received - rest.suppliers.paid),
      },
      documents: {
        sales: int(rest.docs['sales']),
        refunds: int(rest.docs['refunds']),
        receipts: int(rest.docs['receipts']),
        disbursements: int(rest.docs['disbursements']),
        purchaseOrders: int(rest.docs['purchase_orders']),
      },
    };
    void minorOf;
    return { pack, status: rest.status };
  }
}

/** Refuses a second close of the same month (the unique key is the last line of defence). */
async function assertPeriodOpenMonth(tx: Transaction, merchantId: string, period: string) {
  const [row] = await tx
    .select({ id: periodCloses.id })
    .from(periodCloses)
    .where(eq(periodCloses.period, period));
  if (row) throw new AppError(409, 'PERIOD_NOT_CLOSABLE', `${period} is already closed.`);
  void merchantId;
}
