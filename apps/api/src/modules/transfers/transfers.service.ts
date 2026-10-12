import type {
  Transfer,
  createTransferSchema,
  transferListQuerySchema,
  transferQuantitiesSchema,
} from '@arabat/contracts';
import { Money, formatQuantity, parseQuantity } from '@arabat/money';
import { can, permissionBranchScope } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { type SQL, asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { nextDocumentNumber } from '../../database/schema/sequences.schema.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { StockLedgerService } from '../inventory/stock-ledger.service.js';
import { assertStockItems } from '../purchasing/purchasing.service.js';
import { stockTransferLines, stockTransfers } from './transfers.schema.js';

type CreateInput = z.output<typeof createTransferSchema>;
type QuantitiesInput = z.output<typeof transferQuantitiesSchema>;
type ListQuery = z.output<typeof transferListQuerySchema>;

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/**
 * Branch-to-branch stock transfers (Prompt 12), on the existing inventory ledger:
 * dispatch = `transfer_out` at the source (never below zero, regardless of the merchant's
 * negative-stock policy); receipt = `transfer_in` at the destination at the dispatch cost.
 * Between the two the goods are in transit. Each step locks the transfer row and checks
 * its status and version, so a step can never run twice.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly ledger: StockLedgerService,
  ) {}

  async create(actor: MerchantActor, input: CreateInput, ip: string): Promise<Transfer> {
    if (
      !can(actor.access, 'inventory.transfer', input.sourceBranchId) &&
      !can(actor.access, 'inventory.transfer', input.destinationBranchId)
    )
      throw AppError.forbidden();
    const lines = input.lines.map((l, i) => {
      const q = parseQuantity(l.quantity);
      if (q <= 0n)
        throw new AppError(400, 'INVALID_QUANTITY', 'Quantity must be positive.', [
          { path: `lines.${i}.quantity`, code: 'too_small', message: 'Quantity must be positive.' },
        ]);
      return { variantId: l.variantId, quantityMilli: q };
    });
    const id = newId();
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      for (const b of [input.sourceBranchId, input.destinationBranchId]) {
        const [row] = (await tx.execute(sql`select status from branches where id = ${b}`)).rows as {
          status: string;
        }[];
        if (!row) throw AppError.notFound('Branch not found.');
        if (row.status !== 'active')
          throw new AppError(409, 'BRANCH_INACTIVE', 'Both branches must be active.');
      }
      await assertStockItems(
        tx,
        lines.map((l) => l.variantId),
      );
      const number = await nextDocumentNumber(tx, actor.merchantId, 'transfer', 'TR');
      await tx.insert(stockTransfers).values({
        id,
        merchantId: actor.merchantId,
        number,
        sourceBranchId: input.sourceBranchId,
        destinationBranchId: input.destinationBranchId,
        note: input.note,
        requestedByUserId: actor.userId,
      });
      await tx.insert(stockTransferLines).values(
        lines.map((l, position) => ({
          merchantId: actor.merchantId,
          transferId: id,
          position,
          variantId: l.variantId,
          requestedQuantity: formatQuantity(l.quantityMilli),
        })),
      );
      await this.record(tx, actor, 'transfer.requested', id, ip, { number });
    });
    return this.get(actor, id);
  }

  async approve(actor: MerchantActor, id: string, version: number, ip: string): Promise<Transfer> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const t = await this.lock(tx, id, version);
      assertCan(actor, 'inventory.transfer.approve', t.sourceBranchId);
      if (t.status !== 'requested') throw this.state('Only requested transfers can be approved.');
      await this.update(tx, id, {
        status: 'approved',
        approvedByUserId: actor.userId,
        approvedAt: sql`now()`,
      });
      await this.record(tx, actor, 'transfer.approved', id, ip);
    });
    return this.get(actor, id);
  }

  async cancel(actor: MerchantActor, id: string, version: number, ip: string): Promise<Transfer> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const t = await this.lock(tx, id, version);
      const allowed =
        t.requestedByUserId === actor.userId ||
        can(actor.access, 'inventory.transfer.approve', t.sourceBranchId);
      if (!allowed) throw AppError.forbidden();
      if (!['requested', 'approved'].includes(t.status))
        throw this.state('Transfers can only be cancelled before dispatch.');
      await this.update(tx, id, {
        status: 'cancelled',
        cancelledByUserId: actor.userId,
        cancelledAt: sql`now()`,
      });
      await this.record(tx, actor, 'transfer.cancelled', id, ip);
    });
    return this.get(actor, id);
  }

  /** Stock leaves the source branch and is in transit. */
  async dispatch(
    actor: MerchantActor,
    id: string,
    input: QuantitiesInput,
    ip: string,
  ): Promise<Transfer> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const t = await this.lock(tx, id, input.version);
      assertCan(actor, 'inventory.transfer', t.sourceBranchId);
      if (t.status !== 'approved') throw this.state('Only approved transfers can be dispatched.');
      const lines = await tx
        .select()
        .from(stockTransferLines)
        .where(eq(stockTransferLines.transferId, id))
        .orderBy(asc(stockTransferLines.position));
      const quantities = this.quantities(
        input,
        lines.map((l) => ({ position: l.position, maxMilli: parseQuantity(l.requestedQuantity) })),
      );
      const moving = lines.filter((l) => (quantities.get(l.position) ?? 0n) > 0n);
      if (moving.length === 0)
        throw AppError.validation([
          { path: 'lines', code: 'empty', message: 'Dispatch at least one item.' },
        ]);
      const applied = await this.ledger.apply(
        tx,
        {
          merchantId: actor.merchantId,
          branchId: t.sourceBranchId,
          movementType: 'transfer_out',
          sourceType: 'transfer',
          sourceId: id,
          note: t.number,
          userId: actor.userId,
          negative: 'deny',
        },
        moving.map((l) => ({
          variantId: l.variantId,
          mode: 'delta' as const,
          quantityMilli: -quantities.get(l.position)!,
        })),
      );
      for (const l of lines) {
        const idx = moving.indexOf(l);
        await tx
          .update(stockTransferLines)
          .set({
            dispatchedQuantity: formatQuantity(quantities.get(l.position) ?? 0n),
            unitCostMinor: idx >= 0 ? applied[idx]!.unitCostMinor : null,
          })
          .where(
            sql`${stockTransferLines.transferId} = ${id} and ${stockTransferLines.position} = ${l.position}`,
          );
      }
      await this.update(tx, id, {
        status: 'in_transit',
        dispatchedByUserId: actor.userId,
        dispatchedAt: sql`now()`,
      });
      await this.record(tx, actor, 'transfer.dispatched', id, ip, {
        lines: lines.map((l) => ({
          position: l.position,
          quantity: formatQuantity(quantities.get(l.position) ?? 0n),
        })),
      });
    });
    return this.get(actor, id);
  }

  /** The destination confirms what arrived; anything missing is recorded as a discrepancy. */
  async receive(
    actor: MerchantActor,
    id: string,
    input: QuantitiesInput,
    ip: string,
  ): Promise<Transfer> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const t = await this.lock(tx, id, input.version);
      assertCan(actor, 'inventory.transfer', t.destinationBranchId);
      if (t.status !== 'in_transit') throw this.state('Only transfers in transit can be received.');
      const lines = await tx
        .select()
        .from(stockTransferLines)
        .where(eq(stockTransferLines.transferId, id))
        .orderBy(asc(stockTransferLines.position));
      const quantities = this.quantities(
        input,
        lines.map((l) => ({
          position: l.position,
          maxMilli: parseQuantity(l.dispatchedQuantity ?? '0'),
        })),
      );
      const short = lines.some(
        (l) => (quantities.get(l.position) ?? 0n) < parseQuantity(l.dispatchedQuantity ?? '0'),
      );
      if (short && !input.note)
        throw AppError.validation([
          { path: 'note', code: 'required', message: 'Explain the missing quantity.' },
        ]);
      const arriving = lines.filter((l) => (quantities.get(l.position) ?? 0n) > 0n);
      if (arriving.length > 0)
        await this.ledger.apply(
          tx,
          {
            merchantId: actor.merchantId,
            branchId: t.destinationBranchId,
            movementType: 'transfer_in',
            sourceType: 'transfer',
            sourceId: id,
            note: t.number,
            userId: actor.userId,
          },
          arriving.map((l) => ({
            variantId: l.variantId,
            mode: 'delta' as const,
            quantityMilli: quantities.get(l.position)!,
            unitCostMinor: l.unitCostMinor,
          })),
        );
      for (const l of lines)
        await tx
          .update(stockTransferLines)
          .set({ receivedQuantity: formatQuantity(quantities.get(l.position) ?? 0n) })
          .where(
            sql`${stockTransferLines.transferId} = ${id} and ${stockTransferLines.position} = ${l.position}`,
          );
      await this.update(tx, id, {
        status: 'received',
        receivedByUserId: actor.userId,
        receivedAt: sql`now()`,
        discrepancyNote: short ? input.note : null,
      });
      await this.record(
        tx,
        actor,
        short ? 'transfer.received_with_discrepancy' : 'transfer.received',
        id,
        ip,
        {
          lines: lines.map((l) => ({
            position: l.position,
            dispatched: l.dispatchedQuantity,
            received: formatQuantity(quantities.get(l.position) ?? 0n),
          })),
        },
      );
    });
    return this.get(actor, id);
  }

  private quantities(
    input: QuantitiesInput,
    lines: { position: number; maxMilli: bigint }[],
  ): Map<number, bigint> {
    const result = new Map<number, bigint>();
    input.lines.forEach((l, i) => {
      const line = lines.find((x) => x.position === l.position);
      if (!line)
        throw AppError.validation([
          { path: `lines.${i}.position`, code: 'not_found', message: 'Not a transfer line.' },
        ]);
      if (result.has(l.position))
        throw AppError.validation([
          { path: 'lines', code: 'duplicate', message: 'Each line may appear only once.' },
        ]);
      const q = parseQuantity(l.quantity);
      if (q > line.maxMilli)
        throw new AppError(409, 'RECEIVE_EXCEEDS_ORDER', 'More than requested or dispatched.', [
          {
            path: `lines.${i}.quantity`,
            code: 'too_big',
            message: `max=${formatQuantity(line.maxMilli)}`,
          },
        ]);
      result.set(l.position, q);
    });
    return result;
  }

  // ------------------------------------------------------------ reads
  async list(actor: MerchantActor, query: ListQuery) {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const c: SQL[] = [this.scope(actor, query.branchId)];
      if (query.status) c.push(sql`t.status = ${query.status}`);
      const where = sql.join(c, sql` and `);
      const [total] = (
        await tx.execute(sql`select count(*)::int as n from stock_transfers t where ${where}`)
      ).rows as { n: number }[];
      const ids = (
        await tx.execute(sql`select t.id from stock_transfers t where ${where} order by t.created_at desc, t.id desc
                             limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`)
      ).rows as { id: string }[];
      const transfers = [];
      for (const { id } of ids) {
        const { lines: _l, ...rest } = await this.load(tx, actor, id);
        transfers.push(rest);
      }
      return { transfers, total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
    });
  }

  async get(actor: MerchantActor, id: string): Promise<Transfer> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const t = await this.load(tx, actor, id);
      if (
        !can(actor.access, 'inventory.read', t.sourceBranchId) &&
        !can(actor.access, 'inventory.read', t.destinationBranchId)
      )
        throw AppError.forbidden();
      return t;
    });
  }

  private scope(actor: MerchantActor, branchId?: string): SQL {
    if (branchId) {
      assertCan(actor, 'inventory.read', branchId);
      return sql`(t.source_branch_id = ${branchId} or t.destination_branch_id = ${branchId})`;
    }
    const s = permissionBranchScope(actor.access, 'inventory.read');
    if (s.all) return sql`true`;
    if (s.branchIds.length === 0) throw AppError.forbidden();
    const list = sql.join(
      s.branchIds.map((b) => sql`${b}`),
      sql`, `,
    );
    return sql`(t.source_branch_id in (${list}) or t.destination_branch_id in (${list}))`;
  }

  private async load(tx: Transaction, actor: MerchantActor, id: string): Promise<Transfer> {
    const [t] = (
      await tx.execute(sql`
        select t.*, ru.full_name as requested_by, au.full_name as approved_by, du.full_name as dispatched_by, cu.full_name as received_by
        from stock_transfers t join users ru on ru.id = t.requested_by_user_id
        left join users au on au.id = t.approved_by_user_id left join users du on du.id = t.dispatched_by_user_id
        left join users cu on cu.id = t.received_by_user_id where t.id = ${id}`)
    ).rows as Record<string, unknown>[];
    if (!t) throw AppError.notFound();
    const lines = (
      await tx.execute(sql`
        select l.*, l.requested_quantity::text as req, l.dispatched_quantity::text as disp, l.received_quantity::text as rec,
               p.name_en, p.name_ar, v.name_en as v_en, v.name_ar as v_ar, v.sku
        from stock_transfer_lines l join product_variants v on v.id = l.variant_id join products p on p.id = v.product_id
        where l.transfer_id = ${id} order by l.position`)
    ).rows as Record<string, unknown>[];
    const costVisible =
      can(actor.access, 'catalog.prices.manage', null) ||
      can(actor.access, 'reports.inventory', t['source_branch_id'] as string);
    let discrepancy = 0n;
    return {
      id,
      number: t['number'] as string,
      sourceBranchId: t['source_branch_id'] as string,
      destinationBranchId: t['destination_branch_id'] as string,
      status: t['status'] as Transfer['status'],
      note: (t['note'] as string | null) ?? null,
      discrepancyNote: (t['discrepancy_note'] as string | null) ?? null,
      requestedBy: t['requested_by'] as string,
      approvedBy: (t['approved_by'] as string | null) ?? null,
      dispatchedBy: (t['dispatched_by'] as string | null) ?? null,
      receivedBy: (t['received_by'] as string | null) ?? null,
      createdAt: iso(t['created_at'])!,
      dispatchedAt: iso(t['dispatched_at']),
      receivedAt: iso(t['received_at']),
      lines: lines.map((l) => {
        const disp = l['disp'] === null ? null : parseQuantity(l['disp'] as string);
        const rec = l['rec'] === null ? null : parseQuantity(l['rec'] as string);
        const diff = disp !== null && rec !== null ? disp - rec : null;
        if (diff) discrepancy += diff;
        return {
          position: l['position'] as number,
          variantId: l['variant_id'] as string,
          nameEn: (l['name_en'] as string | null) ?? null,
          nameAr: (l['name_ar'] as string | null) ?? null,
          variantNameEn: (l['v_en'] as string | null) ?? null,
          variantNameAr: (l['v_ar'] as string | null) ?? null,
          sku: (l['sku'] as string | null) ?? null,
          requestedQuantity: formatQuantity(parseQuantity(l['req'] as string)),
          dispatchedQuantity: disp === null ? null : formatQuantity(disp),
          receivedQuantity: rec === null ? null : formatQuantity(rec),
          discrepancyQuantity: diff === null ? null : formatQuantity(diff),
          ...(costVisible
            ? {
                unitCost:
                  l['unit_cost_minor'] === null
                    ? null
                    : Money.ofMinor(BigInt(l['unit_cost_minor'] as string), 'KWD').toJSON(),
              }
            : {}),
        };
      }),
      discrepancyQuantity: formatQuantity(discrepancy),
      version: t['version'] as number,
    };
  }

  private state(message: string) {
    return new AppError(409, 'INVALID_STATE', message);
  }

  private async lock(tx: Transaction, id: string, version: number) {
    const [t] = await tx
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.id, id))
      .for('update');
    if (!t) throw AppError.notFound();
    if (t.version !== version) throw versionConflict();
    return t;
  }

  private async update(
    tx: Transaction,
    id: string,
    set: {
      [K in keyof typeof stockTransfers.$inferInsert]?:
        (typeof stockTransfers.$inferInsert)[K] | SQL;
    },
  ) {
    await tx
      .update(stockTransfers)
      .set({ ...set, version: sql`${stockTransfers.version} + 1`, updatedAt: sql`now()` })
      .where(eq(stockTransfers.id, id));
  }

  private record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    id: string,
    ip: string,
    details: Record<string, unknown> = {},
  ) {
    return this.audit.recordIn(tx, {
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action,
      targetType: 'stock_transfer',
      targetId: id,
      ip,
      details,
    });
  }
}
