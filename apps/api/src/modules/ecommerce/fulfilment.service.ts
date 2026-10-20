import type {
  OnlineDeliveryArea,
  OnlineStoreBranch,
  StoreHours,
  saveOnlineDeliveryAreaSchema,
  saveOnlineStoreBranchSchema,
} from '@arabat/contracts';
import { Money } from '@arabat/money';
import { can } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { parseAmount } from '../payments/payments.service.js';
import { onlineStores } from './ecommerce.schema.js';

type Row = Record<string, unknown>;
const CURRENCY = 'KWD' as const;
const money = (minor: bigint | string) => Money.ofMinor(BigInt(minor), CURRENCY).toJSON();
const str = (v: unknown) => (v as string | null) ?? null;

/** A branch that serves the store, with the flags the storefront and checkout need. */
export type ServingBranch = {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
  address: string | null;
  phone: string | null;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  preparationMinutes: number;
  hours: StoreHours;
};
/** A delivery area with its serving branch resolved. */
export type ServingArea = {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
  feeMinor: bigint;
  minimumOrderMinor: bigint;
  freeDeliveryFromMinor: bigint | null;
  estimatedMinutes: number | null;
  branchId: string;
};

/**
 * Fulfilment configuration of the online store (ADR-0123): delivery areas and the branches
 * that serve the store. Both are optional: a store without areas charges its flat delivery
 * fee, and a store without branch rows is served by its single fulfilment branch, as before.
 */
@Injectable()
export class FulfilmentService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private assertManage(actor: MerchantActor) {
    if (!can(actor.access, 'online.manage')) throw AppError.forbidden();
  }

  // ------------------------------------------------------------ delivery areas
  private areaView(r: Row): OnlineDeliveryArea {
    return {
      id: r['id'] as string,
      nameEn: str(r['name_en']),
      nameAr: str(r['name_ar']),
      fee: money(r['fee_minor'] as string),
      minimumOrder: money(r['minimum_order_minor'] as string),
      freeDeliveryFrom:
        r['free_delivery_from_minor'] === null
          ? null
          : money(r['free_delivery_from_minor'] as string),
      estimatedMinutes: (r['estimated_minutes'] as number | null) ?? null,
      branchId: str(r['branch_id']),
      position: r['position'] as number,
      active: r['active'] as boolean,
      version: r['version'] as number,
    };
  }

  private async areaRows(tx: Transaction): Promise<OnlineDeliveryArea[]> {
    const rows = (
      await tx.execute(
        sql`select * from online_delivery_areas order by position, coalesce(lower(name_en), name_ar)`,
      )
    ).rows as Row[];
    return rows.map((r) => this.areaView(r));
  }

  async areas(actor: MerchantActor): Promise<{ areas: OnlineDeliveryArea[] }> {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => ({
      areas: await this.areaRows(tx),
    }));
  }

  private async assertBranch(tx: Transaction, branchId: string | null) {
    if (!branchId) return;
    const [b] = (await tx.execute(sql`select 1 from branches where id = ${branchId}`)).rows;
    if (!b) throw AppError.notFound('Branch not found.');
  }

  async createArea(
    actor: MerchantActor,
    input: z.output<typeof saveOnlineDeliveryAreaSchema>,
    ip: string,
  ): Promise<OnlineDeliveryArea> {
    this.assertManage(actor);
    const id = newId();
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await this.assertBranch(tx, input.branchId);
      await tx.execute(sql`
        insert into online_delivery_areas (id, merchant_id, name_en, name_ar, fee_minor, minimum_order_minor,
          free_delivery_from_minor, estimated_minutes, branch_id, position, active)
        values (${id}, ${actor.merchantId}, ${input.nameEn}, ${input.nameAr}, ${parseAmount(input.fee, 'fee')},
          ${parseAmount(input.minimumOrder, 'minimumOrder')},
          ${input.freeDeliveryFrom === null ? null : parseAmount(input.freeDeliveryFrom, 'freeDeliveryFrom')},
          ${input.estimatedMinutes}, ${input.branchId},
          coalesce((select max(position) + 1 from online_delivery_areas), 0), ${input.active})`);
      await this.record(tx, actor, 'online.delivery_area_created', id, ip, {
        name: input.nameAr ?? input.nameEn,
        fee: input.fee,
      });
    });
    return this.area(actor, id);
  }

  async updateArea(
    actor: MerchantActor,
    id: string,
    input: z.output<typeof saveOnlineDeliveryAreaSchema>,
    ip: string,
  ): Promise<OnlineDeliveryArea> {
    this.assertManage(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = (
        await tx.execute(sql`select version from online_delivery_areas where id = ${id} for update`)
      ).rows as Row[];
      if (!row) throw AppError.notFound('Delivery area not found.');
      if (input.version !== undefined && row['version'] !== input.version) throw versionConflict();
      await this.assertBranch(tx, input.branchId);
      await tx.execute(sql`
        update online_delivery_areas set name_en = ${input.nameEn}, name_ar = ${input.nameAr},
          fee_minor = ${parseAmount(input.fee, 'fee')}, minimum_order_minor = ${parseAmount(input.minimumOrder, 'minimumOrder')},
          free_delivery_from_minor = ${input.freeDeliveryFrom === null ? null : parseAmount(input.freeDeliveryFrom, 'freeDeliveryFrom')},
          estimated_minutes = ${input.estimatedMinutes}, branch_id = ${input.branchId}, active = ${input.active},
          version = version + 1, updated_at = now()
        where id = ${id}`);
      await this.record(tx, actor, 'online.delivery_area_updated', id, ip, {
        name: input.nameAr ?? input.nameEn,
        fee: input.fee,
        active: input.active,
      });
    });
    return this.area(actor, id);
  }

  async deleteArea(actor: MerchantActor, id: string, ip: string) {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = (
        await tx.execute(
          sql`delete from online_delivery_areas where id = ${id} returning name_en, name_ar`,
        )
      ).rows as Row[];
      if (!row) throw AppError.notFound('Delivery area not found.');
      await this.record(tx, actor, 'online.delivery_area_deleted', id, ip, {
        name: row['name_ar'] ?? row['name_en'],
      });
      return { areas: await this.areaRows(tx) };
    });
  }

  async orderAreas(actor: MerchantActor, ids: string[], ip: string) {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const existing = (
        (await tx.execute(sql`select id from online_delivery_areas for update`)).rows as {
          id: string;
        }[]
      ).map((r) => r.id);
      if (
        ids.length !== existing.length ||
        new Set(ids).size !== ids.length ||
        !ids.every((i) => existing.includes(i))
      )
        throw AppError.validation([
          { path: 'ids', code: 'invalid', message: 'Send every delivery area exactly once.' },
        ]);
      for (const [position, id] of ids.entries())
        await tx.execute(
          sql`update online_delivery_areas set position = ${position}, updated_at = now() where id = ${id}`,
        );
      await this.record(tx, actor, 'online.delivery_areas_reordered', actor.merchantId, ip, {
        count: ids.length,
      });
      return { areas: await this.areaRows(tx) };
    });
  }

  private async area(actor: MerchantActor, id: string): Promise<OnlineDeliveryArea> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [r] = (await tx.execute(sql`select * from online_delivery_areas where id = ${id}`))
        .rows as Row[];
      if (!r) throw AppError.notFound('Delivery area not found.');
      return this.areaView(r);
    });
  }

  // ------------------------------------------------------------ serving branches
  private branchView(r: Row): OnlineStoreBranch {
    return {
      branchId: r['branch_id'] as string,
      nameEn: str(r['name_en']),
      nameAr: str(r['name_ar']),
      address: str(r['address']),
      phone: str(r['phone']),
      pickupEnabled: r['pickup_enabled'] as boolean,
      deliveryEnabled: r['delivery_enabled'] as boolean,
      preparationMinutes: r['preparation_minutes'] as number,
      hours: (r['hours'] as StoreHours) ?? null,
      position: r['position'] as number,
      active: r['active'] as boolean,
      version: r['version'] as number,
    };
  }

  private async branchRows(tx: Transaction): Promise<OnlineStoreBranch[]> {
    const rows = (
      await tx.execute(sql`
        select sb.*, b.name_en, b.name_ar, b.address, b.phone
        from online_store_branches sb join branches b on b.id = sb.branch_id
        order by sb.position, b.is_main desc, b.created_at`)
    ).rows as Row[];
    return rows.map((r) => this.branchView(r));
  }

  async storeBranches(actor: MerchantActor): Promise<{ branches: OnlineStoreBranch[] }> {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => ({
      branches: await this.branchRows(tx),
    }));
  }

  async saveStoreBranch(
    actor: MerchantActor,
    branchId: string,
    input: z.output<typeof saveOnlineStoreBranchSchema>,
    ip: string,
  ): Promise<OnlineStoreBranch> {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [b] = (await tx.execute(sql`select status from branches where id = ${branchId}`))
        .rows as Row[];
      if (!b) throw AppError.notFound('Branch not found.');
      if (b['status'] !== 'active' && input.active)
        throw new AppError(409, 'BRANCH_INACTIVE', 'An inactive branch cannot serve the store.');
      const [row] = (
        await tx.execute(
          sql`select version from online_store_branches where branch_id = ${branchId} for update`,
        )
      ).rows as Row[];
      if (row && input.version !== undefined && row['version'] !== input.version)
        throw versionConflict();
      const hours = input.hours === null ? null : JSON.stringify(input.hours);
      if (row)
        await tx.execute(sql`
          update online_store_branches set pickup_enabled = ${input.pickupEnabled}, delivery_enabled = ${input.deliveryEnabled},
            preparation_minutes = ${input.preparationMinutes}, hours = ${hours}::jsonb, active = ${input.active},
            version = version + 1, updated_at = now()
          where branch_id = ${branchId}`);
      else
        await tx.execute(sql`
          insert into online_store_branches (merchant_id, branch_id, pickup_enabled, delivery_enabled, preparation_minutes, hours, position, active)
          values (${actor.merchantId}, ${branchId}, ${input.pickupEnabled}, ${input.deliveryEnabled}, ${input.preparationMinutes},
            ${hours}::jsonb, coalesce((select max(position) + 1 from online_store_branches), 0), ${input.active})`);
      await this.record(tx, actor, 'online.store_branch_saved', branchId, ip, {
        pickup: input.pickupEnabled,
        delivery: input.deliveryEnabled,
        active: input.active,
      });
      const [r] = (
        await tx.execute(sql`
          select sb.*, b.name_en, b.name_ar, b.address, b.phone
          from online_store_branches sb join branches b on b.id = sb.branch_id where sb.branch_id = ${branchId}`)
      ).rows as Row[];
      return this.branchView(r!);
    });
  }

  async removeStoreBranch(actor: MerchantActor, branchId: string, ip: string) {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = (
        await tx.execute(
          sql`delete from online_store_branches where branch_id = ${branchId} returning branch_id`,
        )
      ).rows;
      if (!row) throw AppError.notFound('Branch not found.');
      await this.record(tx, actor, 'online.store_branch_removed', branchId, ip, {});
      return { branches: await this.branchRows(tx) };
    });
  }

  async orderStoreBranches(actor: MerchantActor, branchIds: string[], ip: string) {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const existing = (
        (await tx.execute(sql`select branch_id from online_store_branches for update`)).rows as {
          branch_id: string;
        }[]
      ).map((r) => r.branch_id);
      if (
        branchIds.length !== existing.length ||
        new Set(branchIds).size !== branchIds.length ||
        !branchIds.every((i) => existing.includes(i))
      )
        throw AppError.validation([
          { path: 'branchIds', code: 'invalid', message: 'Send every branch exactly once.' },
        ]);
      for (const [position, id] of branchIds.entries())
        await tx.execute(
          sql`update online_store_branches set position = ${position}, updated_at = now() where branch_id = ${id}`,
        );
      await this.record(tx, actor, 'online.store_branches_reordered', actor.merchantId, ip, {
        count: branchIds.length,
      });
      return { branches: await this.branchRows(tx) };
    });
  }

  // ------------------------------------------------------------ storefront helpers (in a merchant tx)
  /**
   * The branches serving the store: the active configured ones, or the single fulfilment
   * branch with the store's flags when none is configured.
   */
  async servingBranches(
    tx: Transaction,
    store: typeof onlineStores.$inferSelect & { fulfillmentBranchId: string },
  ): Promise<ServingBranch[]> {
    const rows = (
      await tx.execute(sql`
        select sb.branch_id, b.name_en, b.name_ar, b.address, b.phone, sb.pickup_enabled, sb.delivery_enabled,
               sb.preparation_minutes, sb.hours
        from online_store_branches sb join branches b on b.id = sb.branch_id
        where sb.active and b.status = 'active'
        order by sb.position, b.is_main desc, b.created_at`)
    ).rows as Row[];
    if (rows.length > 0)
      return rows.map((r) => ({
        id: r['branch_id'] as string,
        nameEn: str(r['name_en']),
        nameAr: str(r['name_ar']),
        address: str(r['address']),
        phone: str(r['phone']),
        pickupEnabled: r['pickup_enabled'] as boolean,
        deliveryEnabled: r['delivery_enabled'] as boolean,
        preparationMinutes: r['preparation_minutes'] as number,
        hours: (r['hours'] as StoreHours) ?? (store.hours as StoreHours) ?? null,
      }));
    const [b] = (
      await tx.execute(
        sql`select id, name_en, name_ar, address, phone from branches where id = ${store.fulfillmentBranchId}`,
      )
    ).rows as Row[];
    if (!b) throw AppError.notFound('Store not found.');
    return [
      {
        id: b['id'] as string,
        nameEn: str(b['name_en']),
        nameAr: str(b['name_ar']),
        address: str(b['address']),
        phone: str(b['phone']),
        pickupEnabled: store.pickupEnabled,
        deliveryEnabled: store.deliveryEnabled,
        preparationMinutes: 0,
        hours: (store.hours as StoreHours) ?? null,
      },
    ];
  }

  /** Active delivery areas with their serving branch resolved to the store's default. */
  async servingAreas(tx: Transaction, defaultBranchId: string): Promise<ServingArea[]> {
    const rows = (
      await tx.execute(sql`
        select a.* from online_delivery_areas a
        left join branches b on b.id = a.branch_id
        where a.active and (a.branch_id is null or b.status = 'active')
        order by a.position, coalesce(lower(a.name_en), a.name_ar)`)
    ).rows as Row[];
    return rows.map((r) => ({
      id: r['id'] as string,
      nameEn: str(r['name_en']),
      nameAr: str(r['name_ar']),
      feeMinor: BigInt(r['fee_minor'] as string),
      minimumOrderMinor: BigInt(r['minimum_order_minor'] as string),
      freeDeliveryFromMinor:
        r['free_delivery_from_minor'] === null
          ? null
          : BigInt(r['free_delivery_from_minor'] as string),
      estimatedMinutes: (r['estimated_minutes'] as number | null) ?? null,
      branchId: str(r['branch_id']) ?? defaultBranchId,
    }));
  }

  /** Orders already booked per slot start at a branch (cancelled ones excluded). */
  async slotLoad(
    tx: Transaction,
    branchId: string,
    from: Date,
    to: Date,
  ): Promise<Map<string, number>> {
    const rows = (
      await tx.execute(sql`
        select scheduled_for, count(*)::int as n from online_orders
        where branch_id = ${branchId} and scheduled_for >= ${from.toISOString()}::timestamptz
          and scheduled_for < ${to.toISOString()}::timestamptz
          and status not in ('cancelled', 'expired', 'payment_failed')
        group by 1`)
    ).rows as { scheduled_for: string; n: number }[];
    return new Map(rows.map((r) => [new Date(r.scheduled_for).toISOString(), r.n]));
  }

  private record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    id: string,
    ip: string,
    details: Row,
  ) {
    return this.audit.recordIn(tx, {
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action,
      targetType: action.startsWith('online.delivery_area')
        ? 'online_delivery_area'
        : 'online_store_branch',
      targetId: id,
      ip,
      details,
    });
  }
}
