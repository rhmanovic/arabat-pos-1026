import {
  type Customer,
  type CustomerNote,
  type CustomerStats,
  type PosCustomer,
  type createCustomerSchema,
  type customerListQuerySchema,
  normalizePhone,
  type saveCustomerSchema,
} from '@arabat/contracts';
import { Money } from '@arabat/money';
import { canAnywhere, can, permissionBranchScope } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { nextDocumentNumber } from '../../database/schema/sequences.schema.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { SalesService } from '../sales/sales.service.js';
import { customerNotes, customers } from './customers.schema.js';

type CreateInput = z.output<typeof createCustomerSchema>;
type SaveInput = z.output<typeof saveCustomerSchema>;
type ListQuery = z.output<typeof customerListQuerySchema>;

const CURRENCY = 'KWD' as const;
const money = (minor: bigint | string) => Money.ofMinor(BigInt(minor), CURRENCY).toJSON();
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const DUPLICATE_PHONE = () =>
  new AppError(409, 'DUPLICATE_PHONE', 'Another customer already has this phone number.', [
    {
      path: 'phone',
      code: 'duplicate',
      message: 'Another customer already has this phone number.',
    },
  ]);

/**
 * Finds the customer with this phone (canonical form) or creates a basic profile; used by
 * the online store checkout (Prompt 16), where there is no staff member creating it.
 */
export async function ensureCustomerByPhone(
  tx: Transaction,
  merchantId: string,
  input: { fullName: string; phone: string; email: string | null },
): Promise<string | null> {
  const phone = normalizePhone(input.phone);
  if (!phone) return null;
  const [found] = (await tx.execute(sql`select id from customers where phone = ${phone}`)).rows as {
    id: string;
  }[];
  if (found) return found.id;
  const id = newId();
  const code = await nextDocumentNumber(tx, merchantId, 'customer', 'C');
  await tx
    .insert(customers)
    .values({ id, merchantId, code, fullName: input.fullName, phone, email: input.email });
  return id;
}

/** Exact average (half-up to the fils) of non-negative totals. */
function average(total: bigint, count: number): bigint {
  if (count === 0) return 0n;
  const n = BigInt(count);
  return (2n * total + n) / (2n * n);
}

/**
 * Customer profiles (Prompt 13). Customers are merchant-wide; who may see them is decided
 * by `customers.read` held at any branch, and their purchase history and spending are
 * limited to the branches where the viewer holds `customers.read` (BR-112). Sales point
 * at customers (`sales.customer_id`), so history and totals are always derived from the
 * immutable sales and refunds, never stored twice.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly sales: SalesService,
  ) {}

  /** SQL condition limiting sales/refunds (alias `x`) to the viewer's branches. */
  private branchScope(actor: MerchantActor, column: SQL): SQL {
    const scope = permissionBranchScope(actor.access, 'customers.read');
    if (scope.all) return sql`true`;
    if (scope.branchIds.length === 0) return sql`false`;
    return sql`${column} in (${sql.join(
      scope.branchIds.map((b) => sql`${b}`),
      sql`, `,
    )})`;
  }

  private assertAnywhere(
    actor: MerchantActor,
    permission: 'customers.read' | 'customers.create' | 'customers.manage',
  ) {
    if (!canAnywhere(actor.access, permission)) throw AppError.forbidden();
  }

  // ------------------------------------------------------------ manager
  async list(actor: MerchantActor, query: ListQuery) {
    this.assertAnywhere(actor, 'customers.read');
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const conditions: SQL[] = [sql`true`];
      if (query.status) conditions.push(sql`c.status = ${query.status}`);
      if (query.q) {
        const digits = query.q.replace(/\D/g, '');
        conditions.push(
          sql`(lower(c.full_name) like lower(${like(query.q)}) or c.code ilike ${like(query.q)}
               or lower(c.email) like lower(${like(query.q)})
               ${digits.length >= 3 ? sql`or c.phone like ${like(digits)}` : sql``})`,
        );
      }
      const where = sql.join(conditions, sql` and `);
      const order =
        query.sort === 'name'
          ? sql`lower(c.full_name), c.code`
          : query.sort === 'spend'
            ? sql`coalesce(s.total, 0) - coalesce(r.total, 0) desc, c.code`
            : sql`coalesce(s.last_at, c.created_at) desc, c.code desc`;
      const [count] = (
        await tx.execute(sql`select count(*)::int as n from customers c where ${where}`)
      ).rows as { n: number }[];
      const rows = await this.rows(
        tx,
        actor,
        where,
        order,
        query.pageSize,
        (query.page - 1) * query.pageSize,
      );
      return { customers: rows, total: count!.n, page: query.page, pageSize: query.pageSize };
    });
  }

  private async rows(
    tx: Transaction,
    actor: MerchantActor,
    where: SQL,
    order: SQL,
    limit: number,
    offset: number,
  ): Promise<Customer[]> {
    const salesScope = this.branchScope(actor, sql.raw('"x"."branch_id"'));
    const refundScope = this.branchScope(actor, sql.raw('"rf"."branch_id"'));
    const rows = (
      await tx.execute(sql`
        select c.*, coalesce(u.full_name, 'Online store') as created_by,
               coalesce(s.n, 0) as sales_count, coalesce(s.total, 0)::text as sales_total,
               s.first_at, s.last_at,
               coalesce(r.n, 0) as refunds_count, coalesce(r.total, 0)::text as refunded_total
        from customers c
        left join users u on u.id = c.created_by_user_id
        left join (select x.customer_id, count(*)::int as n, sum(x.total_minor) as total,
                          min(x.created_at) as first_at, max(x.created_at) as last_at
                   from sales x where x.customer_id is not null and ${salesScope}
                   group by x.customer_id) s on s.customer_id = c.id
        left join (select x.customer_id, count(*)::int as n, sum(rf.total_minor) as total
                   from refunds rf join sales x on x.id = rf.sale_id
                   where rf.status = 'completed' and x.customer_id is not null and ${refundScope}
                   group by x.customer_id) r on r.customer_id = c.id
        where ${where}
        order by ${order}
        limit ${limit} offset ${offset}`)
    ).rows as Record<string, unknown>[];
    return rows.map((r) => {
      const salesTotal = BigInt(r['sales_total'] as string);
      const refunded = BigInt(r['refunded_total'] as string);
      const salesCount = r['sales_count'] as number;
      const stats: CustomerStats = {
        salesCount,
        salesTotal: money(salesTotal),
        refundsCount: r['refunds_count'] as number,
        refundedTotal: money(refunded),
        netTotal: money(salesTotal - refunded),
        averageSale: money(average(salesTotal, salesCount)),
        firstPurchaseAt: iso(r['first_at']),
        lastPurchaseAt: iso(r['last_at']),
      };
      return {
        id: r['id'] as string,
        code: r['code'] as string,
        fullName: r['full_name'] as string,
        phone: (r['phone'] as string | null) ?? null,
        email: (r['email'] as string | null) ?? null,
        address: (r['address'] as string | null) ?? null,
        preferredLanguage: (r['preferred_language'] as 'ar' | 'en' | null) ?? null,
        status: r['status'] as Customer['status'],
        createdBy: r['created_by'] as string,
        createdAt: iso(r['created_at'])!,
        updatedAt: iso(r['updated_at'])!,
        stats,
        version: r['version'] as number,
      };
    });
  }

  async get(actor: MerchantActor, id: string): Promise<Customer> {
    this.assertAnywhere(actor, 'customers.read');
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await this.rows(tx, actor, sql`c.id = ${id}`, sql`c.code`, 1, 0);
      if (!row) throw AppError.notFound();
      return row;
    });
  }

  /** Purchase history, limited to the viewer's `customers.read` branches. */
  async salesHistory(actor: MerchantActor, id: string, page: number, pageSize: number) {
    await this.get(actor, id);
    return this.sales.list(actor, { customerId: id, page, pageSize }, 'customers.read');
  }

  async refunds(actor: MerchantActor, id: string) {
    await this.get(actor, id);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select rf.id, rf.refund_number, rf.sale_id, x.receipt_number, rf.branch_id, rf.kind,
                 rf.status, rf.total_minor::text as total, rf.created_at
          from refunds rf join sales x on x.id = rf.sale_id
          where x.customer_id = ${id} and ${this.branchScope(actor, sql.raw('"rf"."branch_id"'))}
          order by rf.created_at desc limit 200`)
      ).rows as Record<string, unknown>[];
      return {
        refunds: rows.map((r) => ({
          id: r['id'] as string,
          refundNumber: r['refund_number'] as string,
          saleId: r['sale_id'] as string,
          receiptNumber: r['receipt_number'] as string,
          branchId: r['branch_id'] as string,
          kind: r['kind'] as string,
          status: r['status'] as string,
          total: money(r['total'] as string),
          createdAt: iso(r['created_at'])!,
        })),
      };
    });
  }

  async create(
    actor: MerchantActor,
    input: CreateInput | SaveInput,
    ip: string,
    branchId: string | null,
  ): Promise<string> {
    if (branchId) {
      if (!can(actor.access, 'customers.create', branchId)) throw AppError.forbidden();
    } else this.assertAnywhere(actor, 'customers.create');
    const id = newId();
    try {
      await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const code = await nextDocumentNumber(tx, actor.merchantId, 'customer', 'C');
        const full = 'address' in input ? input : null;
        await tx.insert(customers).values({
          id,
          merchantId: actor.merchantId,
          code,
          fullName: input.fullName,
          phone: input.phone,
          email: input.email,
          address: full?.address ?? null,
          preferredLanguage: full?.preferredLanguage ?? null,
          status: full?.status ?? 'active',
          createdByUserId: actor.userId,
          createdBranchId: branchId,
        });
        // Personal data stays out of the audit log; the record id is enough to trace it.
        await this.record(tx, actor, 'customer.created', id, ip, { code });
      });
    } catch (error) {
      if (isUniqueViolation(error, 'customers_phone_key')) throw DUPLICATE_PHONE();
      throw error;
    }
    return id;
  }

  async update(actor: MerchantActor, id: string, input: SaveInput, ip: string): Promise<void> {
    this.assertAnywhere(actor, 'customers.manage');
    if (!input.version)
      throw AppError.validation([
        { path: 'version', code: 'required', message: 'version is required' },
      ]);
    try {
      await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const [before] = (
          await tx.execute(sql`select * from customers where id = ${id} for update`)
        ).rows as Record<string, unknown>[];
        if (!before) throw AppError.notFound();
        if (before['version'] !== input.version) throw versionConflict();
        const next = {
          fullName: input.fullName,
          phone: input.phone,
          email: input.email,
          address: input.address,
          preferredLanguage: input.preferredLanguage,
          status: input.status,
        };
        const columns: Record<keyof typeof next, string> = {
          fullName: 'full_name',
          phone: 'phone',
          email: 'email',
          address: 'address',
          preferredLanguage: 'preferred_language',
          status: 'status',
        };
        const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
          (k) => (before[columns[k]] ?? null) !== next[k],
        );
        if (changed.length === 0) return;
        await tx
          .update(customers)
          .set({ ...next, version: sql`${customers.version} + 1`, updatedAt: sql`now()` })
          .where(sql`${customers.id} = ${id}`);
        await this.record(
          tx,
          actor,
          changed.includes('status')
            ? `customer.${next.status === 'active' ? 'activated' : 'deactivated'}`
            : 'customer.updated',
          id,
          ip,
          { fields: changed },
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'customers_phone_key')) throw DUPLICATE_PHONE();
      throw error;
    }
  }

  async notes(actor: MerchantActor, id: string): Promise<CustomerNote[]> {
    await this.get(actor, id);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select n.id, n.body, n.created_at, u.full_name from customer_notes n
          join users u on u.id = n.created_by_user_id
          where n.customer_id = ${id} order by n.created_at desc, n.id desc`)
      ).rows as Record<string, unknown>[];
      return rows.map((r) => ({
        id: r['id'] as string,
        body: r['body'] as string,
        author: r['full_name'] as string,
        createdAt: iso(r['created_at'])!,
      }));
    });
  }

  async addNote(actor: MerchantActor, id: string, body: string, ip: string): Promise<void> {
    this.assertAnywhere(actor, 'customers.manage');
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [exists] = (await tx.execute(sql`select id from customers where id = ${id}`)).rows as {
        id: string;
      }[];
      if (!exists) throw AppError.notFound();
      const noteId = newId();
      await tx.insert(customerNotes).values({
        id: noteId,
        merchantId: actor.merchantId,
        customerId: id,
        body,
        createdByUserId: actor.userId,
      });
      await this.record(tx, actor, 'customer.note_added', id, ip, { noteId });
    });
  }

  // ------------------------------------------------------------ POS
  private assertPos(actor: MerchantActor, permission: 'customers.read' | 'customers.create') {
    const branchId = actor.boundBranchId;
    if (!branchId || !can(actor.access, permission, branchId)) throw AppError.forbidden();
    return branchId;
  }

  /** Till search: active customers only, identification fields only (BR-113). */
  async posSearch(actor: MerchantActor, q: string): Promise<PosCustomer[]> {
    this.assertPos(actor, 'customers.read');
    const digits = q.replace(/\D/g, '');
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select id, code, full_name, phone, status from customers
          where status = 'active' and (lower(full_name) like lower(${like(q)}) or code ilike ${like(q)}
                ${digits.length >= 3 ? sql`or phone like ${like(digits)}` : sql``})
          order by lower(full_name), code
          limit 20`)
      ).rows as Record<string, unknown>[];
      return rows.map((r) => this.posView(r));
    });
  }

  async posCreate(actor: MerchantActor, input: CreateInput, ip: string): Promise<PosCustomer> {
    const branchId = this.assertPos(actor, 'customers.create');
    const id = await this.create(actor, input, ip, branchId);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = (
        await tx.execute(
          sql`select id, code, full_name, phone, status from customers where id = ${id}`,
        )
      ).rows as Record<string, unknown>[];
      return this.posView(row!);
    });
  }

  private posView(r: Record<string, unknown>): PosCustomer {
    return {
      id: r['id'] as string,
      code: r['code'] as string,
      fullName: r['full_name'] as string,
      phone: (r['phone'] as string | null) ?? null,
      status: r['status'] as PosCustomer['status'],
    };
  }

  private record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    id: string,
    ip: string,
    details: Record<string, unknown>,
  ) {
    return this.audit.recordIn(tx, {
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action,
      targetType: 'customer',
      targetId: id,
      ip,
      details,
    });
  }
}
