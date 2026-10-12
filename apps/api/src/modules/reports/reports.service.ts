import type {
  InventoryReport,
  PaymentsReport,
  PurchasingReport,
  ReportPeriod,
  SalesReport,
  SalesSummary,
  ShiftsReport,
  reportQuerySchema,
} from '@arabat/contracts';
import { Money, formatQuantity, parseQuantity } from '@arabat/money';
import { type PermissionKey, can, permissionBranchScope } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { outcomeOf } from '../registers/shifts.service.js';

type Query = z.output<typeof reportQuerySchema>;
type Row = Record<string, unknown>;

const CURRENCY = 'KWD' as const;
const money = (minor: bigint | string | null | undefined) =>
  Money.ofMinor(BigInt(minor ?? 0), CURRENCY).toJSON();
const big = (v: unknown) => BigInt((v as string | number | null) ?? 0);
const int = (v: unknown) => Number(v ?? 0);
const qty = (v: unknown) => formatQuantity(parseQuantity(String(v ?? '0')));
const iso = (v: unknown) => new Date(v as string).toISOString();
const minorOf = (m: { amount: string }) => Money.parse(m.amount, CURRENCY).minor;
const desc = (a: bigint, b: bigint) => (b > a ? 1 : b < a ? -1 : 0);

/** Exact half-up division of non-negative integers. */
function divHalfUp(a: bigint, b: bigint): bigint {
  if (b === 0n) return 0n;
  const negative = a < 0n !== b < 0n;
  const [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
  const q = (2n * x + y) / (2n * y);
  return negative ? -q : q;
}

/** a ÷ b × 100 with one decimal, half-up (e.g. "37.5"); null when b ≤ 0. */
export function percentOf(a: bigint, b: bigint): string | null {
  if (b <= 0n) return null;
  const tenths = divHalfUp(a * 1000n, b);
  const sign = tenths < 0n ? '-' : '';
  const abs = tenths < 0n ? -tenths : tenths;
  return `${sign}${abs / 10n}.${abs % 10n}`;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

interface Ctx {
  tz: string;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  /** null = every branch of the merchant. */
  branchIds: string[] | null;
  membershipId: string | null;
  userId: string | null;
}

/**
 * Management reports (Prompt 14) computed on demand from the transactional tables. Metric
 * definitions: BUSINESS_RULES.md BR-120…BR-129. Every period is a range of merchant-local
 * calendar days `[from 00:00, to + 1 day 00:00)` in the merchant's time zone. Amounts are
 * summed as integers in SQL and converted with exact bigint arithmetic.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly database: DatabaseService) {}

  // ------------------------------------------------------------ helpers
  private branchScope(actor: MerchantActor, permission: PermissionKey, branchId?: string) {
    if (branchId) {
      assertCan(actor, permission, branchId);
      return [branchId];
    }
    const scope = permissionBranchScope(actor.access, permission);
    if (scope.all) return null;
    if (scope.branchIds.length === 0) throw AppError.forbidden();
    return [...scope.branchIds];
  }

  private async context(
    tx: Transaction,
    actor: MerchantActor,
    permission: PermissionKey,
    query: Query,
  ): Promise<Ctx> {
    const branchIds = this.branchScope(actor, permission, query.branchId);
    const [m] = (
      await tx.execute(sql`select timezone from merchants where id = ${actor.merchantId}`)
    ).rows as { timezone: string }[];
    if (query.branchId) {
      // RLS limits this to the merchant: another merchant's branch is simply not found.
      const [branch] = (await tx.execute(sql`select id from branches where id = ${query.branchId}`))
        .rows as { id: string }[];
      if (!branch) throw AppError.notFound('Branch not found.');
    }
    let userId: string | null = null;
    if (query.employeeId) {
      const [member] = (
        await tx.execute(sql`select user_id from memberships where id = ${query.employeeId}`)
      ).rows as { user_id: string }[];
      if (!member) throw AppError.notFound('Employee not found.');
      userId = member.user_id;
    }
    const days = eachDay(query.from, query.to).length;
    return {
      tz: m?.timezone ?? 'Asia/Kuwait',
      from: query.from,
      to: query.to,
      prevFrom: addDays(query.from, -days),
      prevTo: addDays(query.from, -1),
      branchIds,
      membershipId: query.employeeId ?? null,
      userId,
    };
  }

  private period(c: Ctx): ReportPeriod {
    return {
      from: c.from,
      to: c.to,
      timezone: c.tz,
      previousFrom: c.prevFrom,
      previousTo: c.prevTo,
    };
  }

  /** `column` within the local days [from, to]. */
  private within(c: Ctx, column: SQL, from = c.from, to = c.to): SQL {
    return sql`${column} >= (${from}::date)::timestamp at time zone ${c.tz}
               and ${column} < ((${to}::date + 1)::timestamp at time zone ${c.tz})`;
  }

  private branches(c: Ctx, column: SQL): SQL {
    if (c.branchIds === null) return sql`true`;
    return sql`${column} in (${sql.join(
      c.branchIds.map((b) => sql`${b}`),
      sql`, `,
    )})`;
  }

  private member(c: Ctx, column: SQL): SQL {
    return c.membershipId ? sql`${column} = ${c.membershipId}` : sql`true`;
  }

  private day(c: Ctx, column: SQL): SQL {
    return sql`to_char((${column} at time zone ${c.tz})::date, 'YYYY-MM-DD')`;
  }

  private async rows(tx: Transaction, query: SQL): Promise<Row[]> {
    return (await tx.execute(query)).rows as Row[];
  }

  /** True when the actor holds `permission` for every branch in the report. */
  private coversScope(actor: MerchantActor, permission: PermissionKey, c: Ctx): boolean {
    if (c.branchIds === null) return permissionBranchScope(actor.access, permission).all;
    return c.branchIds.every((b) => can(actor.access, permission, b));
  }

  // ------------------------------------------------------------ sales
  private async salesSummary(
    tx: Transaction,
    c: Ctx,
    from: string,
    to: string,
  ): Promise<SalesSummary> {
    const where = sql`${this.within(c, sql.raw('s.created_at'), from, to)}
      and ${this.branches(c, sql.raw('s.branch_id'))} and ${this.member(c, sql.raw('s.membership_id'))}`;
    const [s] = await this.rows(
      tx,
      sql`select count(*)::int as n, coalesce(sum(s.subtotal_minor), 0)::text as gross,
                 coalesce(sum(s.line_discounts_minor), 0)::text as ld,
                 coalesce(sum(s.order_discount_minor), 0)::text as od,
                 coalesce(sum(s.total_minor), 0)::text as net,
                 coalesce((select sum(l.quantity) from sale_lines l join sales s on s.id = l.sale_id
                           where ${where}), 0)::text as items
          from sales s where ${where}`,
    );
    const [r] = await this.rows(
      tx,
      sql`select count(*)::int as n, coalesce(sum(r.total_minor), 0)::text as total
          from refunds r where r.status = 'completed'
            and ${this.within(c, sql.raw('r.completed_at'), from, to)}
            and ${this.branches(c, sql.raw('r.branch_id'))} and ${this.member(c, sql.raw('r.membership_id'))}`,
    );
    const net = big(s!['net']);
    const refunds = big(r!['total']);
    const count = int(s!['n']);
    return {
      saleCount: count,
      itemsSold: qty(s!['items']),
      gross: money(big(s!['gross'])),
      lineDiscounts: money(big(s!['ld'])),
      orderDiscounts: money(big(s!['od'])),
      discounts: money(big(s!['ld']) + big(s!['od'])),
      netSales: money(net),
      refundCount: int(r!['n']),
      refunds: money(refunds),
      netAfterRefunds: money(net - refunds),
      averageSale: money(divHalfUp(net, BigInt(count))),
    };
  }

  async sales(actor: MerchantActor, query: Query): Promise<SalesReport> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const c = await this.context(tx, actor, 'reports.sales', query);
      const saleWhere = sql`${this.within(c, sql.raw('s.created_at'))}
        and ${this.branches(c, sql.raw('s.branch_id'))} and ${this.member(c, sql.raw('s.membership_id'))}`;
      const refundWhere = sql`r.status = 'completed' and ${this.within(c, sql.raw('r.completed_at'))}
        and ${this.branches(c, sql.raw('r.branch_id'))} and ${this.member(c, sql.raw('r.membership_id'))}`;

      const summary = await this.salesSummary(tx, c, c.from, c.to);
      const previous = await this.salesSummary(tx, c, c.prevFrom, c.prevTo);

      // By day (every day of the period, zero-filled).
      const daySales = new Map(
        (
          await this.rows(
            tx,
            sql`select ${this.day(c, sql.raw('s.created_at'))} as d, count(*)::int as n,
                       sum(s.total_minor)::text as net
                from sales s where ${saleWhere} group by 1`,
          )
        ).map((r) => [r['d'] as string, r]),
      );
      const dayRefunds = new Map(
        (
          await this.rows(
            tx,
            sql`select ${this.day(c, sql.raw('r.completed_at'))} as d, sum(r.total_minor)::text as total
                from refunds r where ${refundWhere} group by 1`,
          )
        ).map((r) => [r['d'] as string, r]),
      );
      const byDay = eachDay(c.from, c.to).map((date) => ({
        date,
        saleCount: int(daySales.get(date)?.['n']),
        netSales: money(big(daySales.get(date)?.['net'])),
        refunds: money(big(dayRefunds.get(date)?.['total'])),
      }));

      const hours = new Map(
        (
          await this.rows(
            tx,
            sql`select extract(hour from s.created_at at time zone ${c.tz})::int as h, count(*)::int as n,
                       sum(s.total_minor)::text as net
                from sales s where ${saleWhere} group by 1`,
          )
        ).map((r) => [int(r['h']), r]),
      );
      const byHour = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        saleCount: int(hours.get(hour)?.['n']),
        netSales: money(big(hours.get(hour)?.['net'])),
      }));

      // By branch.
      const branchRefunds = new Map(
        (
          await this.rows(
            tx,
            sql`select r.branch_id, sum(r.total_minor)::text as total from refunds r where ${refundWhere} group by 1`,
          )
        ).map((r) => [r['branch_id'] as string, big(r['total'])]),
      );
      const branchSales = await this.rows(
        tx,
        sql`select s.branch_id, count(*)::int as n, sum(s.subtotal_minor)::text as gross,
                   sum(s.line_discounts_minor + s.order_discount_minor)::text as disc,
                   sum(s.total_minor)::text as net
            from sales s where ${saleWhere} group by 1`,
      );
      const branchIds = new Set([
        ...branchSales.map((r) => r['branch_id'] as string),
        ...branchRefunds.keys(),
      ]);
      const byBranch = [...branchIds]
        .map((branchId) => {
          const s = branchSales.find((r) => r['branch_id'] === branchId);
          const refunds = branchRefunds.get(branchId) ?? 0n;
          const net = big(s?.['net']);
          return {
            branchId,
            saleCount: int(s?.['n']),
            gross: money(big(s?.['gross'])),
            discounts: money(big(s?.['disc'])),
            netSales: money(net),
            refunds: money(refunds),
            netAfterRefunds: money(net - refunds),
          };
        })
        .sort((a, b) => desc(minorOf(a.netSales), minorOf(b.netSales)));

      // By employee (who rang up the sale / requested the refund).
      const empSales = await this.rows(
        tx,
        sql`select s.membership_id, max(u.full_name) as name, count(*)::int as n,
                   sum(s.line_discounts_minor + s.order_discount_minor)::text as disc,
                   sum(s.total_minor)::text as net
            from sales s join users u on u.id = s.user_id where ${saleWhere} group by 1`,
      );
      const empRefunds = await this.rows(
        tx,
        sql`select r.membership_id, max(u.full_name) as name, sum(r.total_minor)::text as total
            from refunds r join users u on u.id = r.user_id where ${refundWhere} group by 1`,
      );
      const members = new Set([
        ...empSales.map((r) => r['membership_id'] as string),
        ...empRefunds.map((r) => r['membership_id'] as string),
      ]);
      const byEmployee = [...members]
        .map((membershipId) => {
          const s = empSales.find((r) => r['membership_id'] === membershipId);
          const r = empRefunds.find((x) => x['membership_id'] === membershipId);
          return {
            membershipId,
            name: ((s ?? r)!['name'] as string) ?? '',
            saleCount: int(s?.['n']),
            discounts: money(big(s?.['disc'])),
            netSales: money(big(s?.['net'])),
            refunds: money(big(r?.['total'])),
          };
        })
        .sort((a, b) => desc(minorOf(a.netSales), minorOf(b.netSales)));

      const byPaymentMethod = (
        await this.rows(
          tx,
          sql`select p.method_kind, max(p.method_name_en) as name_en, max(p.method_name_ar) as name_ar,
                     count(*)::int as n, sum(p.amount_minor)::text as amount
              from payments p join sales s on s.id = p.sale_id
              where p.status = 'succeeded' and ${saleWhere}
              group by p.method_kind, p.payment_method_id order by sum(p.amount_minor) desc`,
        )
      ).map((r) => ({
        kind: r['method_kind'] as string,
        nameEn: (r['name_en'] as string | null) ?? null,
        nameAr: (r['name_ar'] as string | null) ?? null,
        count: int(r['n']),
        amount: money(big(r['amount'])),
      }));

      // By product: sold in the period vs. refunded in the period.
      const productSales = await this.rows(
        tx,
        sql`select l.variant_id, max(l.name_en) as name_en, max(l.name_ar) as name_ar,
                   max(l.variant_name_en) as vn_en, max(l.variant_name_ar) as vn_ar, max(l.sku) as sku,
                   sum(l.quantity)::text as qty, sum(l.net_minor)::text as net
            from sale_lines l join sales s on s.id = l.sale_id where ${saleWhere}
            group by l.variant_id`,
      );
      const productRefunds = await this.rows(
        tx,
        sql`select rl.variant_id, sum(rl.quantity)::text as qty, sum(rl.amount_minor)::text as amount,
                   max(sl.name_en) as name_en, max(sl.name_ar) as name_ar,
                   max(sl.variant_name_en) as vn_en, max(sl.variant_name_ar) as vn_ar, max(sl.sku) as sku
            from refund_lines rl join refunds r on r.id = rl.refund_id
            join sale_lines sl on sl.sale_id = r.sale_id and sl.position = rl.sale_position
            where ${refundWhere} group by rl.variant_id`,
      );
      const variants = new Set([
        ...productSales.map((r) => r['variant_id'] as string),
        ...productRefunds.map((r) => r['variant_id'] as string),
      ]);
      const byProduct = [...variants]
        .map((variantId) => {
          const s = productSales.find((r) => r['variant_id'] === variantId);
          const r = productRefunds.find((x) => x['variant_id'] === variantId);
          const info = (s ?? r)!;
          return {
            variantId,
            nameEn: (info['name_en'] as string | null) ?? null,
            nameAr: (info['name_ar'] as string | null) ?? null,
            variantNameEn: (info['vn_en'] as string | null) ?? null,
            variantNameAr: (info['vn_ar'] as string | null) ?? null,
            sku: (info['sku'] as string | null) ?? null,
            quantity: qty(s?.['qty']),
            netSales: money(big(s?.['net'])),
            refundedQuantity: qty(r?.['qty']),
            refunds: money(big(r?.['amount'])),
            sortKey: big(s?.['net']),
          };
        })
        .sort((a, b) => desc(a.sortKey, b.sortKey))
        .slice(0, 1000)
        .map(({ sortKey: _k, ...rest }) => rest);

      const byCategory = (
        await this.rows(
          tx,
          sql`select p.category_id, max(cat.name_en) as name_en, max(cat.name_ar) as name_ar,
                     sum(l.quantity)::text as qty, sum(l.net_minor)::text as net
              from sale_lines l join sales s on s.id = l.sale_id
              join products p on p.id = l.product_id left join categories cat on cat.id = p.category_id
              where ${saleWhere} group by p.category_id order by sum(l.net_minor) desc`,
        )
      ).map((r) => ({
        categoryId: (r['category_id'] as string | null) ?? null,
        nameEn: (r['name_en'] as string | null) ?? null,
        nameAr: (r['name_ar'] as string | null) ?? null,
        quantity: qty(r['qty']),
        netSales: money(big(r['net'])),
      }));

      // Gross profit (BR-127): only with reports.financial for the whole scope, and only
      // when every sale (and every restocked refund line) in the period has a known cost.
      let profit: SalesReport['profit'] = null;
      if (this.coversScope(actor, 'reports.financial', c)) {
        const [cost] = await this.rows(
          tx,
          sql`select count(*) filter (where s.cost_minor is null)::int as missing,
                     coalesce(sum(s.cost_minor), 0)::text as cogs
              from sales s where ${saleWhere}`,
        );
        const [back] = await this.rows(
          tx,
          sql`select count(*) filter (where rl.unit_cost_minor is null)::int as missing,
                     coalesce(sum(round(rl.quantity * rl.unit_cost_minor)), 0)::text as restocked
              from refund_lines rl join refunds r on r.id = rl.refund_id
              where rl.restock and ${refundWhere}`,
        );
        const missing = int(cost!['missing']) + int(back!['missing']);
        const netAfter = minorOf(summary.netAfterRefunds);
        if (missing > 0)
          profit = {
            available: false,
            missingCostSales: missing,
            costOfSales: null,
            restockedCost: null,
            grossProfit: null,
            marginPercent: null,
          };
        else {
          const cogs = big(cost!['cogs']);
          const restocked = big(back!['restocked']);
          const gp = netAfter - (cogs - restocked);
          profit = {
            available: true,
            missingCostSales: 0,
            costOfSales: money(cogs),
            restockedCost: money(restocked),
            grossProfit: money(gp),
            marginPercent: percentOf(gp, netAfter),
          };
        }
      }

      return {
        period: this.period(c),
        summary,
        previous,
        byDay,
        byHour,
        byBranch,
        byEmployee,
        byPaymentMethod,
        byProduct,
        byCategory,
        profit,
      };
    });
  }

  // ------------------------------------------------------------ payments & cash
  async payments(actor: MerchantActor, query: Query): Promise<PaymentsReport> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const c = await this.context(tx, actor, 'reports.financial', query);
      // Collections: money actually received for sales (exchange credit is internal, BR-124).
      const payWhere = (
        from: string,
        to: string,
      ) => sql`p.status = 'succeeded' and p.verification <> 'internal'
        and ${this.within(c, sql.raw('p.created_at'), from, to)} and ${this.branches(c, sql.raw('p.branch_id'))}
        and ${this.member(c, sql.raw('s.membership_id'))}`;
      // Pay-outs: settled refund payments of refunds completed in the period.
      const outWhere = sql`rp.status = 'succeeded' and rp.method_kind <> 'exchange' and r.status = 'completed'
        and ${this.within(c, sql.raw('r.completed_at'))} and ${this.branches(c, sql.raw('r.branch_id'))}
        and ${this.member(c, sql.raw('r.membership_id'))}`;
      const collected = await this.rows(
        tx,
        sql`select p.method_kind, p.payment_method_id, max(p.method_name_en) as name_en,
                   max(p.method_name_ar) as name_ar, count(*)::int as n,
                   sum(p.amount_minor)::text as amount, sum(p.fee_minor)::text as fees
            from payments p join sales s on s.id = p.sale_id where ${payWhere(c.from, c.to)}
            group by p.method_kind, p.payment_method_id`,
      );
      const paidOut = await this.rows(
        tx,
        sql`select rp.method_kind, rp.payment_method_id, max(rp.method_name_en) as name_en,
                   max(rp.method_name_ar) as name_ar, sum(rp.amount_minor)::text as amount
            from refund_payments rp join refunds r on r.id = rp.refund_id where ${outWhere}
            group by rp.method_kind, rp.payment_method_id`,
      );
      const keyOf = (r: Row) =>
        `${r['method_kind'] as string}|${(r['payment_method_id'] as string | null) ?? ''}`;
      const keys = new Set([...collected.map(keyOf), ...paidOut.map(keyOf)]);
      const collections = [...keys].map((key) => {
        const inRow = collected.find((r) => keyOf(r) === key);
        const outRow = paidOut.find((r) => keyOf(r) === key);
        const info = (inRow ?? outRow)!;
        const amount = big(inRow?.['amount']);
        const refunded = big(outRow?.['amount']);
        return {
          kind: info['method_kind'] as string,
          methodId: (info['payment_method_id'] as string | null) ?? null,
          nameEn: (info['name_en'] as string | null) ?? null,
          nameAr: (info['name_ar'] as string | null) ?? null,
          count: int(inRow?.['n']),
          collected: money(amount),
          fees: money(big(inRow?.['fees'])),
          refunded: money(refunded),
          net: money(amount - refunded),
        };
      });
      const sum = (xs: { amount: string }[]) => xs.reduce((s, x) => s + minorOf(x), 0n);
      const totalIn = sum(collections.map((x) => x.collected));
      const totalFees = sum(collections.map((x) => x.fees));
      const totalOut = sum(collections.map((x) => x.refunded));
      const [prev] = await this.rows(
        tx,
        sql`select coalesce(sum(p.amount_minor), 0)::text as amount
            from payments p join sales s on s.id = p.sale_id where ${payWhere(c.prevFrom, c.prevTo)}`,
      );

      // Cash (BR-125): the same rows the shift drawer uses.
      const cashIn = collections.filter((x) => x.kind === 'cash');
      const [moves] = await this.rows(
        tx,
        sql`select coalesce(sum(m.amount_minor) filter (where m.kind = 'cash_in'), 0)::text as cash_in,
                   coalesce(sum(m.amount_minor) filter (where m.kind = 'cash_out'), 0)::text as cash_out
            from cash_movements m where ${this.within(c, sql.raw('m.created_at'))}
              and ${this.branches(c, sql.raw('m.branch_id'))}
              and ${c.userId ? sql`m.created_by_user_id = ${c.userId}` : sql`true`}`,
      );
      const cashSales = sum(cashIn.map((x) => x.collected));
      const cashRefunds = sum(cashIn.map((x) => x.refunded));

      const refundAllocations = (
        await this.rows(
          tx,
          sql`select rp.method_kind, max(rp.method_name_en) as name_en, max(rp.method_name_ar) as name_ar,
                     rp.status, count(*)::int as n, sum(rp.amount_minor)::text as amount
              from refund_payments rp join refunds r on r.id = rp.refund_id
              where r.status in ('completed', 'processing')
                and ${this.within(c, sql.raw('coalesce(r.completed_at, r.decided_at, r.created_at)'))}
                and ${this.branches(c, sql.raw('r.branch_id'))} and ${this.member(c, sql.raw('r.membership_id'))}
              group by rp.method_kind, rp.payment_method_id, rp.status order by sum(rp.amount_minor) desc`,
        )
      ).map((r) => ({
        kind: r['method_kind'] as string,
        nameEn: (r['name_en'] as string | null) ?? null,
        nameAr: (r['name_ar'] as string | null) ?? null,
        status: r['status'] as string,
        count: int(r['n']),
        amount: money(big(r['amount'])),
      }));

      const dayIn = new Map(
        (
          await this.rows(
            tx,
            sql`select ${this.day(c, sql.raw('p.created_at'))} as d, sum(p.amount_minor)::text as amount
                from payments p join sales s on s.id = p.sale_id where ${payWhere(c.from, c.to)} group by 1`,
          )
        ).map((r) => [r['d'] as string, big(r['amount'])]),
      );
      const dayOut = new Map(
        (
          await this.rows(
            tx,
            sql`select ${this.day(c, sql.raw('r.completed_at'))} as d, sum(rp.amount_minor)::text as amount
                from refund_payments rp join refunds r on r.id = rp.refund_id where ${outWhere} group by 1`,
          )
        ).map((r) => [r['d'] as string, big(r['amount'])]),
      );

      return {
        period: this.period(c),
        collections: collections.sort((a, b) => desc(minorOf(a.collected), minorOf(b.collected))),
        totals: {
          collected: money(totalIn),
          fees: money(totalFees),
          refunded: money(totalOut),
          net: money(totalIn - totalOut),
          netAfterFees: money(totalIn - totalOut - totalFees),
          previousCollected: money(big(prev!['amount'])),
        },
        cash: {
          cashSales: money(cashSales),
          cashRefunds: money(cashRefunds),
          cashIn: money(big(moves!['cash_in'])),
          cashOut: money(big(moves!['cash_out'])),
          netCash: money(
            cashSales - cashRefunds + big(moves!['cash_in']) - big(moves!['cash_out']),
          ),
        },
        refundAllocations,
        byDay: eachDay(c.from, c.to).map((date) => ({
          date,
          collected: money(dayIn.get(date) ?? 0n),
          refunded: money(dayOut.get(date) ?? 0n),
        })),
      };
    });
  }

  // ------------------------------------------------------------ shifts
  async shifts(actor: MerchantActor, query: Query): Promise<ShiftsReport> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const c = await this.context(tx, actor, 'reports.financial', query);
      const rows = await this.rows(
        tx,
        sql`select sh.id, sh.branch_id, sh.register_id, rg.code as register_code, u.full_name,
                   sh.opened_at, sh.closed_at, sh.close_type, sh.opening_float_minor::text as float,
                   sh.expected_cash_minor::text as expected, sh.counted_cash_minor::text as counted,
                   sh.discrepancy_minor::text as discrepancy, sh.discrepancy_tolerance_minor::text as tolerance,
                   coalesce(ps.cash, 0)::text as cash_sales, coalesce(rs.cash, 0)::text as cash_refunds,
                   coalesce(ms.cash_in, 0)::text as cash_in, coalesce(ms.cash_out, 0)::text as cash_out
            from shifts sh
            join registers rg on rg.id = sh.register_id
            join memberships mb on mb.id = sh.membership_id join users u on u.id = mb.user_id
            left join (select p.shift_id, sum(p.amount_minor) as cash from payments p
                       where p.method_kind = 'cash' and p.status = 'succeeded' and p.sale_id is not null
                       group by p.shift_id) ps on ps.shift_id = sh.id
            left join (select rp.shift_id, sum(rp.amount_minor) as cash from refund_payments rp
                       where rp.method_kind = 'cash' and rp.status = 'succeeded'
                       group by rp.shift_id) rs on rs.shift_id = sh.id
            left join (select m.shift_id, sum(m.amount_minor) filter (where m.kind = 'cash_in') as cash_in,
                              sum(m.amount_minor) filter (where m.kind = 'cash_out') as cash_out
                       from cash_movements m group by m.shift_id) ms on ms.shift_id = sh.id
            where sh.status = 'closed' and ${this.within(c, sql.raw('sh.closed_at'))}
              and ${this.branches(c, sql.raw('sh.branch_id'))} and ${this.member(c, sql.raw('sh.membership_id'))}
            order by sh.closed_at desc`,
      );
      const shifts = rows.map((r) => {
        const discrepancy = big(r['discrepancy']);
        return {
          id: r['id'] as string,
          branchId: r['branch_id'] as string,
          registerId: r['register_id'] as string,
          registerCode: r['register_code'] as string,
          employeeName: r['full_name'] as string,
          openedAt: iso(r['opened_at']),
          closedAt: iso(r['closed_at']),
          closeType: (r['close_type'] as string | null) ?? null,
          openingFloat: money(big(r['float'])),
          cashSales: money(big(r['cash_sales'])),
          cashRefunds: money(big(r['cash_refunds'])),
          cashIn: money(big(r['cash_in'])),
          cashOut: money(big(r['cash_out'])),
          expectedCash: money(big(r['expected'])),
          countedCash: money(big(r['counted'])),
          discrepancy: money(discrepancy),
          outcome: outcomeOf(discrepancy, big(r['tolerance']))!,
          minor: { expected: big(r['expected']), counted: big(r['counted']), discrepancy },
        };
      });
      const registers = new Map<
        string,
        {
          registerId: string;
          registerCode: string;
          branchId: string;
          n: number;
          e: bigint;
          c: bigint;
          d: bigint;
        }
      >();
      for (const s of shifts) {
        const g = registers.get(s.registerId) ?? {
          registerId: s.registerId,
          registerCode: s.registerCode,
          branchId: s.branchId,
          n: 0,
          e: 0n,
          c: 0n,
          d: 0n,
        };
        g.n += 1;
        g.e += s.minor.expected;
        g.c += s.minor.counted;
        g.d += s.minor.discrepancy;
        registers.set(s.registerId, g);
      }
      const over = shifts.filter((s) => s.outcome === 'over');
      const short = shifts.filter((s) => s.outcome === 'short');
      return {
        period: this.period(c),
        shifts: shifts.map(({ minor: _m, registerId: _r, ...s }) => s),
        registers: [...registers.values()].map((g) => ({
          registerId: g.registerId,
          registerCode: g.registerCode,
          branchId: g.branchId,
          shiftCount: g.n,
          expectedCash: money(g.e),
          countedCash: money(g.c),
          discrepancy: money(g.d),
        })),
        totals: {
          shiftCount: shifts.length,
          balanced: shifts.length - over.length - short.length,
          over: over.length,
          short: short.length,
          totalOver: money(over.reduce((s, x) => s + x.minor.discrepancy, 0n)),
          totalShort: money(short.reduce((s, x) => s + x.minor.discrepancy, 0n)),
          netDiscrepancy: money(shifts.reduce((s, x) => s + x.minor.discrepancy, 0n)),
        },
      };
    });
  }

  // ------------------------------------------------------------ inventory
  async inventory(actor: MerchantActor, query: Query): Promise<InventoryReport> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const c = await this.context(tx, actor, 'reports.inventory', query);
      const levelScope = this.branches(c, sql.raw('l.branch_id'));
      const valuation = (
        await this.rows(
          tx,
          sql`select l.branch_id, count(*)::int as items, coalesce(sum(l.on_hand), 0)::text as qty,
                     coalesce(sum(case when l.on_hand > 0 and l.avg_cost_minor is not null
                                       then round(l.on_hand * l.avg_cost_minor) else 0 end), 0)::text as value,
                     count(*) filter (where l.on_hand > 0 and l.avg_cost_minor is null)::int as unvalued
              from stock_levels l join product_variants v on v.id = l.variant_id
              join products p on p.id = v.product_id
              where p.track_inventory and ${levelScope} group by l.branch_id`,
        )
      ).map((r) => ({
        branchId: r['branch_id'] as string,
        trackedItems: int(r['items']),
        quantity: qty(r['qty']),
        value: money(big(r['value'])),
        unvaluedItems: int(r['unvalued']),
      }));
      const stock = (
        await this.rows(
          tx,
          sql`select l.variant_id, l.branch_id, p.name_en, p.name_ar, v.name_en as vn_en, v.name_ar as vn_ar,
                     v.sku, l.on_hand::text as on_hand, l.low_stock_threshold::text as threshold,
                     l.avg_cost_minor::text as avg
              from stock_levels l join product_variants v on v.id = l.variant_id
              join products p on p.id = v.product_id
              where p.track_inventory and ${levelScope}
                and ((p.status = 'active' and v.status = 'active') or l.on_hand <> 0)
              order by case when l.on_hand < 0 then 0 when l.on_hand = 0 then 1
                            when l.low_stock_threshold is not null and l.on_hand <= l.low_stock_threshold then 2
                            else 3 end,
                       coalesce(lower(p.name_en), p.name_ar), v.sku
              limit 2000`,
        )
      ).map((r) => {
        const onHand = parseQuantity(r['on_hand'] as string);
        const threshold = r['threshold'] === null ? null : parseQuantity(r['threshold'] as string);
        const avg = r['avg'] === null ? null : big(r['avg']);
        return {
          variantId: r['variant_id'] as string,
          branchId: r['branch_id'] as string,
          nameEn: (r['name_en'] as string | null) ?? null,
          nameAr: (r['name_ar'] as string | null) ?? null,
          variantNameEn: (r['vn_en'] as string | null) ?? null,
          variantNameAr: (r['vn_ar'] as string | null) ?? null,
          sku: (r['sku'] as string | null) ?? null,
          onHand: formatQuantity(onHand),
          lowStockThreshold: threshold === null ? null : formatQuantity(threshold),
          averageCost: avg === null ? null : money(avg),
          value: avg === null ? null : money(onHand > 0n ? divHalfUp(onHand * avg, 1000n) : 0n),
          status: (onHand < 0n
            ? 'negative'
            : onHand === 0n
              ? 'out'
              : threshold !== null && onHand <= threshold
                ? 'low'
                : 'in_stock') as 'in_stock' | 'low' | 'out' | 'negative',
        };
      });
      const movementScope = sql`${this.within(c, sql.raw('m.created_at'))} and ${this.branches(c, sql.raw('m.branch_id'))}`;
      const movements = (
        await this.rows(
          tx,
          sql`select m.movement_type, count(*)::int as n,
                     coalesce(sum(m.quantity) filter (where m.quantity > 0), 0)::text as q_in,
                     coalesce(-sum(m.quantity) filter (where m.quantity < 0), 0)::text as q_out,
                     coalesce(sum(m.value_minor), 0)::text as value
              from stock_movements m where ${movementScope} group by 1 order by 1`,
        )
      ).map((r) => ({
        movementType: r['movement_type'] as string,
        count: int(r['n']),
        quantityIn: qty(r['q_in']),
        quantityOut: qty(r['q_out']),
        value: money(big(r['value'])),
      }));
      const adjustments = (
        await this.rows(
          tx,
          sql`select a.kind, a.reason, count(distinct a.id)::int as docs,
                     coalesce(sum(m.quantity), 0)::text as qty
              from stock_adjustments a
              left join stock_movements m on m.source_type = 'stock_adjustment' and m.source_id = a.id
              where ${this.within(c, sql.raw('a.created_at'))} and ${this.branches(c, sql.raw('a.branch_id'))}
              group by a.kind, a.reason order by a.kind, a.reason`,
        )
      ).map((r) => ({
        kind: r['kind'] as string,
        reason: r['reason'] as string,
        documents: int(r['docs']),
        quantity: qty(r['qty']),
      }));
      const sold = await this.rows(
        tx,
        sql`select l.variant_id, max(l.name_en) as name_en, max(l.name_ar) as name_ar, max(l.sku) as sku,
                   sum(l.quantity)::text as qty
            from sale_lines l join sales s on s.id = l.sale_id
            where ${this.within(c, sql.raw('s.created_at'))} and ${this.branches(c, sql.raw('s.branch_id'))}
            group by l.variant_id`,
      );
      const returned = await this.rows(
        tx,
        sql`select rl.variant_id, max(sl.name_en) as name_en, max(sl.name_ar) as name_ar, max(sl.sku) as sku,
                   coalesce(sum(rl.quantity) filter (where rl.restock), 0)::text as back,
                   coalesce(sum(rl.quantity) filter (where not rl.restock), 0)::text as lost
            from refund_lines rl join refunds r on r.id = rl.refund_id
            join sale_lines sl on sl.sale_id = r.sale_id and sl.position = rl.sale_position
            where r.status = 'completed' and ${this.within(c, sql.raw('r.completed_at'))}
              and ${this.branches(c, sql.raw('r.branch_id'))}
            group by rl.variant_id`,
      );
      const ids = new Set([...sold, ...returned].map((r) => r['variant_id'] as string));
      const productQuantities = [...ids]
        .map((variantId) => {
          const s = sold.find((r) => r['variant_id'] === variantId);
          const r = returned.find((x) => x['variant_id'] === variantId);
          const info = (s ?? r)!;
          const soldQ = parseQuantity(String(s?.['qty'] ?? '0'));
          const back = parseQuantity(String(r?.['back'] ?? '0'));
          const lost = parseQuantity(String(r?.['lost'] ?? '0'));
          return {
            variantId,
            nameEn: (info['name_en'] as string | null) ?? null,
            nameAr: (info['name_ar'] as string | null) ?? null,
            sku: (info['sku'] as string | null) ?? null,
            sold: formatQuantity(soldQ),
            returnedToStock: formatQuantity(back),
            returnedNotRestocked: formatQuantity(lost),
            netSold: formatQuantity(soldQ - back - lost),
            k: soldQ,
          };
        })
        .sort((a, b) => desc(a.k, b.k))
        .slice(0, 1000)
        .map(({ k: _k, ...rest }) => rest);
      return {
        period: this.period(c),
        valuation,
        stock,
        movements,
        adjustments,
        productQuantities,
      };
    });
  }

  // ------------------------------------------------------------ purchasing
  async purchasing(actor: MerchantActor, query: Query): Promise<PurchasingReport> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const c = await this.context(tx, actor, 'reports.inventory', query);
      const orderValue = sql`(select coalesce(sum(round(ol.quantity * ol.unit_cost_minor)), 0)
                              from purchase_order_lines ol where ol.purchase_order_id = o.id)`;
      const receiptValue =
        sql.raw(`(select coalesce(sum(round(rl.quantity * ol.unit_cost_minor)), 0)
        from purchase_receipt_lines rl join purchase_order_lines ol
          on ol.purchase_order_id = "rc"."purchase_order_id" and ol.position = rl.order_position
        where rl.receipt_id = "rc"."id")`);
      const orderWhere = sql`o.status <> 'draft' and o.status <> 'cancelled'
        and ${this.within(c, sql.raw('o.created_at'))} and ${this.branches(c, sql.raw('o.branch_id'))}`;
      const receiptWhere = sql`${this.within(c, sql.raw('rc.created_at'))} and ${this.branches(c, sql.raw('rc.branch_id'))}`;
      const [orders] = await this.rows(
        tx,
        sql`select count(*)::int as n, coalesce(sum(${orderValue}), 0)::text as value
            from purchase_orders o where ${orderWhere}`,
      );
      const [received] = await this.rows(
        tx,
        sql`select count(*)::int as n, coalesce(sum(${receiptValue}), 0)::text as value
            from purchase_receipts rc where ${receiptWhere}`,
      );
      const [open] = await this.rows(
        tx,
        sql`select count(*)::int as n,
                   coalesce(sum((select coalesce(sum(round((ol.quantity - coalesce((
                                   select sum(rl.quantity) from purchase_receipt_lines rl
                                   join purchase_receipts rc2 on rc2.id = rl.receipt_id
                                   where rc2.purchase_order_id = ol.purchase_order_id
                                     and rl.order_position = ol.position), 0)) * ol.unit_cost_minor)), 0)
                                 from purchase_order_lines ol where ol.purchase_order_id = o.id)), 0)::text as value
            from purchase_orders o where o.status in ('approved', 'partially_received')
              and ${this.branches(c, sql.raw('o.branch_id'))}`,
      );
      const supplierOrders = await this.rows(
        tx,
        sql`select o.supplier_id, count(*)::int as n, coalesce(sum(${orderValue}), 0)::text as value
            from purchase_orders o where ${orderWhere} group by 1`,
      );
      const supplierReceipts = await this.rows(
        tx,
        sql`select o.supplier_id, count(*)::int as n, coalesce(sum(${receiptValue}), 0)::text as value,
                   max(rc.created_at) as last_at
            from purchase_receipts rc join purchase_orders o on o.id = rc.purchase_order_id
            where ${receiptWhere} group by 1`,
      );
      const supplierIds = [
        ...new Set([...supplierOrders, ...supplierReceipts].map((r) => r['supplier_id'] as string)),
      ];
      const names = new Map(
        supplierIds.length
          ? (
              await this.rows(
                tx,
                sql`select id, name_en, name_ar from suppliers where id in (${sql.join(
                  supplierIds.map((s) => sql`${s}`),
                  sql`, `,
                )})`,
              )
            ).map((r) => [r['id'] as string, r])
          : [],
      );
      const bySupplier = supplierIds
        .map((supplierId) => {
          const o = supplierOrders.find((r) => r['supplier_id'] === supplierId);
          const r = supplierReceipts.find((x) => x['supplier_id'] === supplierId);
          return {
            supplierId,
            nameEn: (names.get(supplierId)?.['name_en'] as string | null) ?? null,
            nameAr: (names.get(supplierId)?.['name_ar'] as string | null) ?? null,
            orders: int(o?.['n']),
            orderedValue: money(big(o?.['value'])),
            receipts: int(r?.['n']),
            receivedValue: money(big(r?.['value'])),
            lastReceiptAt: r?.['last_at'] ? iso(r['last_at']) : null,
            k: big(r?.['value']),
          };
        })
        .sort((a, b) => desc(a.k, b.k))
        .map(({ k: _k, ...rest }) => rest);
      const receipts = (
        await this.rows(
          tx,
          sql`select rc.id, rc.number, o.number as order_number, sp.name_en, sp.name_ar, rc.branch_id,
                     u.full_name, rc.created_at, rc.supplier_reference, ${receiptValue}::text as value
              from purchase_receipts rc join purchase_orders o on o.id = rc.purchase_order_id
              join suppliers sp on sp.id = o.supplier_id join users u on u.id = rc.received_by_user_id
              where ${receiptWhere} order by rc.created_at desc limit 1000`,
        )
      ).map((r) => ({
        id: r['id'] as string,
        number: r['number'] as string,
        orderNumber: r['order_number'] as string,
        supplierName: {
          nameEn: (r['name_en'] as string | null) ?? null,
          nameAr: (r['name_ar'] as string | null) ?? null,
        },
        branchId: r['branch_id'] as string,
        receivedBy: r['full_name'] as string,
        createdAt: iso(r['created_at']),
        supplierReference: (r['supplier_reference'] as string | null) ?? null,
        value: money(big(r['value'])),
      }));
      // Transfers dispatched in the period, visible when either end is in scope.
      const transferScope =
        c.branchIds === null
          ? sql`true`
          : sql`(${this.branches(c, sql.raw('t.source_branch_id'))} or ${this.branches(c, sql.raw('t.destination_branch_id'))})`;
      const transfers = (
        await this.rows(
          tx,
          sql`select t.source_branch_id, t.destination_branch_id, count(distinct t.id)::int as n,
                     coalesce(sum(tl.dispatched_quantity), 0)::text as dispatched,
                     coalesce(sum(tl.received_quantity), 0)::text as received,
                     coalesce(sum(tl.dispatched_quantity - tl.received_quantity) filter (where t.status = 'received'), 0)::text as missing,
                     coalesce(sum(round(tl.dispatched_quantity * tl.unit_cost_minor)), 0)::text as dispatched_value,
                     coalesce(sum(round((tl.dispatched_quantity - tl.received_quantity) * tl.unit_cost_minor))
                              filter (where t.status = 'received'), 0)::text as missing_value
              from stock_transfers t join stock_transfer_lines tl on tl.transfer_id = t.id
              where t.dispatched_at is not null and ${this.within(c, sql.raw('t.dispatched_at'))} and ${transferScope}
              group by 1, 2 order by 3 desc`,
        )
      ).map((r) => ({
        sourceBranchId: r['source_branch_id'] as string,
        destinationBranchId: r['destination_branch_id'] as string,
        transfers: int(r['n']),
        dispatched: qty(r['dispatched']),
        received: qty(r['received']),
        missing: qty(r['missing']),
        dispatchedValue: money(big(r['dispatched_value'])),
        missingValue: money(big(r['missing_value'])),
      }));
      return {
        period: this.period(c),
        summary: {
          ordersCreated: int(orders!['n']),
          orderedValue: money(big(orders!['value'])),
          receipts: int(received!['n']),
          receivedValue: money(big(received!['value'])),
          openOrders: int(open!['n']),
          openValue: money(big(open!['value'])),
        },
        bySupplier,
        receipts,
        transfers,
      };
    });
  }
}
