import type { DeviceSettings, DeviceSnapshot } from '@arabat/contracts';
import { PERMISSION_KEYS, can } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { assertCan } from '../../kernel/access/assert.js';
import { AppError } from '../../kernel/errors/app-error.js';
import type { Device } from '../../kernel/access/device-resolver.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AuditService } from '../audit/audit.service.js';
import { AccessRepository } from '../iam/access.repository.js';
import { DevicesService } from './devices.service.js';

/**
 * Catalog rows written by a transaction that started before a snapshot but committed after it
 * carry an `updated_at` older than the snapshot's version; a delta therefore re-sends this much
 * before `since`. Re-sent products simply replace the device's copy.
 */
const DELTA_OVERLAP_SECONDS = 300;

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown) => new Date(v as string | Date).toISOString();
/** `10.00` → `10`, `12.50` → `12.5` (exact decimal strings, as the sales settings API). */
const decimal = (v: unknown) =>
  v === null || v === undefined
    ? null
    : String(v).includes('.')
      ? String(v).replace(/0+$/, '').replace(/\.$/, '')
      : String(v);

/**
 * Sync download for local-first devices (ADR-0112 §7a, docs/DEVICE_API.md): the branch snapshot,
 * then product deltas since the device's last version. Reference data the device needs in full
 * every time (settings, payment methods, staff, categories) is always complete.
 */
@Injectable()
export class DeviceSyncService {
  constructor(
    private readonly database: DatabaseService,
    private readonly devices: DevicesService,
    private readonly access: AccessRepository,
    private readonly audit: AuditService,
  ) {}

  async download(device: Device, since: string | undefined): Promise<DeviceSnapshot> {
    const sinceDate = since ? new Date(since) : null;
    const described = await this.devices.describe(device);
    return this.database.withMerchantTx(device.merchantId, async (tx) => {
      // A device moved to another branch since `since` needs that branch's whole catalog.
      const [moved] = (
        await tx.execute(sql`select branch_changed_at from pos_devices where id = ${device.id}`)
      ).rows as Row[];
      const movedAt = moved?.['branch_changed_at']
        ? new Date(moved['branch_changed_at'] as string)
        : null;
      const delta =
        sinceDate !== null &&
        !Number.isNaN(sinceDate.getTime()) &&
        (movedAt === null || sinceDate > movedAt);
      const [clock] = (await tx.execute(sql`select now() as now`)).rows as Row[];
      const version = iso(clock!['now']);
      const [merchant] = (
        await tx.execute(sql`
          select id, display_name_en, display_name_ar, timezone, owner_frozen_at, status
          from merchants where id = ${device.merchantId}`)
      ).rows as Row[];
      // A suspended company sells nowhere; the device keeps its unsent records for later.
      if (merchant!['status'] !== 'active')
        throw new AppError(403, 'MERCHANT_SUSPENDED', 'This company is suspended.');
      const [branch] = (
        await tx.execute(sql`
          select id, code, name_en, name_ar, phone, address, receipt_header, receipt_footer
          from branches where id = ${device.branchId}`)
      ).rows as Row[];
      const [register] = (
        await tx.execute(sql`
          select id, code, default_opening_float_minor::text as float, discrepancy_tolerance_minor::text as tolerance
          from registers where id = ${device.registerId}`)
      ).rows as Row[];
      const [s] = (
        await tx.execute(sql`select * from sales_settings where merchant_id = ${device.merchantId}`)
      ).rows as Row[];
      const [inv] = (
        await tx.execute(
          sql`select allow_negative_stock from inventory_settings where merchant_id = ${device.merchantId}`,
        )
      ).rows as Row[];
      const [counter] = (
        await tx.execute(sql`
          select receipt_number from sales where register_id = ${device.registerId}
          order by receipt_number desc limit 1`)
      ).rows as Row[];

      const snapshot: DeviceSnapshot = {
        version,
        full: !delta,
        catalogVersion: await this.catalogVersion(tx, device.merchantId),
        serverTime: version,
        offlineLimitHours: Number(s?.['offline_limit_hours'] ?? 72),
        device: described,
        merchant: {
          id: device.merchantId,
          nameEn: str(merchant!['display_name_en']),
          nameAr: str(merchant!['display_name_ar']),
          currency: 'KWD',
          timezone: String(merchant!['timezone']),
        },
        branch: {
          id: device.branchId,
          code: String(branch!['code']),
          nameEn: str(branch!['name_en']),
          nameAr: str(branch!['name_ar']),
          phone: str(branch!['phone']),
          address: str(branch!['address']),
          receiptHeader: str(branch!['receipt_header']),
          receiptFooter: str(branch!['receipt_footer']),
        },
        register: {
          id: device.registerId,
          code: String(register!['code']),
          defaultOpeningFloatMinor: String(register!['float']),
          discrepancyToleranceMinor: String(register!['tolerance']),
        },
        settings: {
          maxDiscountPercent: decimal(s?.['max_discount_percent'] ?? '10')!,
          priceOverrideFloorPercent: s ? decimal(s['price_override_floor_percent']) : '50',
          priceOverrideCeilingPercent: s ? decimal(s['price_override_ceiling_percent']) : '200',
          priceOverrideBelowCost: Boolean(s?.['price_override_below_cost'] ?? false),
          requireTenderReference: Boolean(s?.['require_tender_reference'] ?? true),
          blindCashCount: Boolean(s?.['blind_cash_count'] ?? true),
          cashOutOtherLimitMinor: String(s?.['cash_out_other_limit_minor'] ?? '20000'),
          cashOutOtherShiftLimitMinor: String(s?.['cash_out_other_shift_limit_minor'] ?? '50000'),
          refundWindowDays: Number(s?.['refund_window_days'] ?? 30),
          refundApprovalLimitMinor: String(s?.['refund_approval_limit_minor'] ?? '20000'),
          refundOwnSalesNeedApproval: Boolean(s?.['refund_own_sales_need_approval'] ?? true),
          allowNegativeStock: Boolean(inv?.['allow_negative_stock'] ?? false),
          heldSaleExpiryHours: Number(s?.['held_sale_expiry_hours'] ?? 24),
        },
        counters: { lastReceiptNumber: str(counter?.['receipt_number']) },
        ...(await this.branchShift(tx, device)),
        paymentMethods: await this.paymentMethods(tx),
        staff: await this.staff(tx, device, Boolean(merchant!['owner_frozen_at'])),
        categories: await this.categories(tx),
        products: await this.products(tx, device.branchId, delta ? sinceDate : null),
      };
      await tx.execute(sql`update pos_devices set last_sync_at = now() where id = ${device.id}`);
      return snapshot;
    });
  }

  /**
   * The branch shift (ADR-0112 amendment 3): the latest shift on the register of the branch's
   * primary device, open or closed, and the primary itself. Secondary devices sell into the
   * open one; the primary learns here when a manager closed its shift online.
   */
  private async branchShift(
    tx: Transaction,
    device: Device,
  ): Promise<Pick<DeviceSnapshot, 'branchShift' | 'primaryDevice'>> {
    const [primary] = (
      await tx.execute(sql`
        select id, name, register_id from pos_devices
        where branch_id = ${device.branchId} and role = 'primary' and revoked_at is null`)
    ).rows as Row[];
    if (!primary) return { branchShift: null, primaryDevice: null };
    const [s] = (
      await tx.execute(sql`
        select s.id, s.status, s.register_id, g.code, s.opened_at, s.closed_at, s.membership_id, s.user_id, u.full_name
        from shifts s join registers g on g.id = s.register_id join users u on u.id = s.user_id
        where s.register_id = ${String(primary['register_id'])}
        order by (s.status = 'open') desc, s.opened_at desc limit 1`)
    ).rows as Row[];
    return {
      primaryDevice: { id: String(primary['id']), name: String(primary['name']) },
      branchShift: s
        ? {
            id: String(s['id']),
            status: s['status'] as 'open' | 'closed',
            registerId: String(s['register_id']),
            registerCode: String(s['code']),
            openedAt: iso(s['opened_at']),
            closedAt: s['closed_at'] ? iso(s['closed_at']) : null,
            openedBy: {
              membershipId: String(s['membership_id']),
              userId: String(s['user_id']),
              fullName: String(s['full_name']),
            },
          }
        : null,
    };
  }

  /** The latest change to anything that prices a sale (products, variants, categories). */
  private async catalogVersion(tx: Transaction, merchantId: string): Promise<string> {
    const [row] = (
      await tx.execute(sql`
        select greatest(
          (select max(updated_at) from products where merchant_id = ${merchantId}),
          (select max(updated_at) from product_variants where merchant_id = ${merchantId}),
          (select max(updated_at) from categories where merchant_id = ${merchantId}),
          (select created_at from merchants where id = ${merchantId})) as v`)
    ).rows as Row[];
    return iso(row!['v']);
  }

  private async paymentMethods(tx: Transaction): Promise<DeviceSnapshot['paymentMethods']> {
    const rows = (
      await tx.execute(sql`
        select id, kind, status, available_in_pos, gateway_provider, financial_account_id, name_en,
               name_ar, fee_type, fee_fixed_minor::text as fee_fixed, fee_percent::text as fee_percent,
               sort_order
        from payment_methods order by sort_order, id`)
    ).rows as Row[];
    return rows.map((r) => ({
      id: String(r['id']),
      kind: String(r['kind']),
      status: String(r['status']),
      availableInPos: Boolean(r['available_in_pos']),
      gatewayProvider: str(r['gateway_provider']),
      financialAccountId: str(r['financial_account_id']),
      nameEn: str(r['name_en']),
      nameAr: str(r['name_ar']),
      feeType: r['fee_type'] as DeviceSnapshot['paymentMethods'][number]['feeType'],
      feeFixedMinor: String(r['fee_fixed']),
      feePercent: decimal(r['fee_percent'])!,
      sortOrder: Number(r['sort_order']),
    }));
  }

  /**
   * Active people who may use the POS at the device's branch, with every permission they hold
   * there (resolved from roles and assignments, as for a browser session) and their PIN hash.
   */
  private async staff(
    tx: Transaction,
    device: Device,
    ownerFrozen: boolean,
  ): Promise<DeviceSnapshot['staff']> {
    const rows = (
      await tx.execute(sql`
        select m.id, m.user_id, m.is_owner, m.pin_hash, u.full_name
        from memberships m join users u on u.id = m.user_id
        where m.merchant_id = ${device.merchantId} and m.status = 'active' and u.status = 'active'
        order by u.full_name, m.id`)
    ).rows as Row[];
    const out: DeviceSnapshot['staff'] = [];
    for (const r of rows) {
      // An owner frozen by the platform (BR-020) is out until released, on devices too.
      if (r['is_owner'] && ownerFrozen) continue;
      const m = await this.access.loadMembershipAccess(tx, String(r['id']));
      if (!m || !can(m.access, 'pos.access', device.branchId)) continue;
      out.push({
        membershipId: m.membershipId,
        userId: m.userId,
        fullName: String(r['full_name']),
        isOwner: m.access.isOwner,
        pinHash: str(r['pin_hash']),
        permissions: PERMISSION_KEYS.filter((k) => can(m.access, k, device.branchId)),
      });
    }
    return out;
  }

  private async categories(tx: Transaction): Promise<DeviceSnapshot['categories']> {
    const rows = (
      await tx.execute(sql`
        select id, parent_id, name_en, name_ar, sort_order, status from categories
        order by sort_order, id`)
    ).rows as Row[];
    return rows.map((r) => ({
      id: String(r['id']),
      parentId: str(r['parent_id']),
      nameEn: str(r['name_en']),
      nameAr: str(r['name_ar']),
      sortOrder: Number(r['sort_order']),
      status: String(r['status']),
    }));
  }

  /**
   * Every product (full), or those whose product or variant rows changed since `since` minus
   * the overlap. `sellable` uses the checkout's rule (`SalesService.loadItems`): active and
   * available at the branch.
   */
  private async products(
    tx: Transaction,
    branchId: string,
    since: Date | null,
  ): Promise<DeviceSnapshot['products']> {
    const changed = since
      ? sql`where p.updated_at > ${since.toISOString()}::timestamptz - make_interval(secs => ${DELTA_OVERLAP_SECONDS})
              or exists (select 1 from product_variants cv where cv.product_id = p.id
                and cv.updated_at > ${since.toISOString()}::timestamptz - make_interval(secs => ${DELTA_OVERLAP_SECONDS}))`
      : sql``;
    const productRows = (
      await tx.execute(sql`
        select p.id, p.category_id, p.name_en, p.name_ar, p.type, p.track_inventory, p.updated_at,
               (p.status = 'active' and (p.available_in_all_branches or exists (
                 select 1 from product_branch_availability a
                 where a.product_id = p.id and a.branch_id = ${branchId}))) as sellable
        from products p ${changed}
        order by p.id`)
    ).rows as Row[];
    if (productRows.length === 0) return [];
    const ids = productRows.map((r) => sql`${r['id']}`);
    const variantRows = (
      await tx.execute(sql`
        select v.id, v.product_id, v.name_en, v.name_ar, v.sku, v.price_minor::text as price,
               v.cost_minor::text as cost, v.is_default, v.status,
               coalesce((select array_agg(b.barcode order by b.barcode) from product_barcodes b
                         where b.variant_id = v.id), '{}') as barcodes
        from product_variants v where v.product_id in (${sql.join(ids, sql`, `)})
        order by v.product_id, v.position, v.id`)
    ).rows as Row[];
    const variants = new Map<string, DeviceSnapshot['products'][number]['variants']>();
    for (const v of variantRows) {
      const list = variants.get(String(v['product_id'])) ?? [];
      list.push({
        id: String(v['id']),
        nameEn: str(v['name_en']),
        nameAr: str(v['name_ar']),
        sku: str(v['sku']),
        priceMinor: String(v['price']),
        costMinor: str(v['cost']),
        isDefault: Boolean(v['is_default']),
        status: String(v['status']),
        barcodes: (v['barcodes'] as string[]) ?? [],
      });
      variants.set(String(v['product_id']), list);
    }
    return productRows.map((r) => ({
      id: String(r['id']),
      categoryId: str(r['category_id']),
      nameEn: str(r['name_en']),
      nameAr: str(r['name_ar']),
      type: String(r['type']),
      trackInventory: Boolean(r['track_inventory']),
      sellable: Boolean(r['sellable']),
      updatedAt: iso(r['updated_at']),
      variants: variants.get(String(r['id'])) ?? [],
    }));
  }

  async getSettings(actor: MerchantActor): Promise<DeviceSettings> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = (
        await tx.execute(
          sql`select offline_limit_hours from sales_settings where merchant_id = ${actor.merchantId}`,
        )
      ).rows as Row[];
      return { offlineLimitHours: Number(row?.['offline_limit_hours'] ?? 72) };
    });
  }

  /** Owner decision 1 (ADR-0112): the hours a device may sell without a successful sync. */
  async updateSettings(
    actor: MerchantActor,
    input: DeviceSettings,
    ip: string,
  ): Promise<DeviceSettings> {
    assertCan(actor, 'merchant.settings.update', null);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const before = await tx.execute(
        sql`select offline_limit_hours from sales_settings where merchant_id = ${actor.merchantId} for update`,
      );
      const from = (before.rows[0] as Row | undefined)?.['offline_limit_hours'] ?? 72;
      await tx.execute(sql`
        insert into sales_settings (merchant_id, offline_limit_hours)
        values (${actor.merchantId}, ${input.offlineLimitHours})
        on conflict (merchant_id) do update
          set offline_limit_hours = excluded.offline_limit_hours,
              version = sales_settings.version + 1, updated_at = now()`);
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'device_settings.updated',
        targetType: 'merchant',
        targetId: actor.merchantId,
        ip,
        details: { offlineLimitHours: { from: Number(from), to: input.offlineLimitHours } },
      });
      return { offlineLimitHours: input.offlineLimitHours };
    });
  }
}
