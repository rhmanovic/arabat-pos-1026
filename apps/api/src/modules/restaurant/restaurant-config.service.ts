import type {
  BranchLayout,
  MenuItem,
  ModifierGroup,
  PosMenu,
  RestaurantSettings,
  saveDiningAreaSchema,
  saveDiningTableSchema,
  saveKitchenStationSchema,
  saveMenuItemSchema,
  saveModifierGroupSchema,
  updateRestaurantSettingsSchema,
} from '@arabat/contracts';
import { Money, formatQuantity, parseQuantity } from '@arabat/money';
import { can, canAnywhere } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { parseAmount } from '../payments/payments.service.js';
import {
  diningAreas,
  diningTables,
  kitchenStationCategories,
  kitchenStations,
  modifierGroups,
  modifiers,
  productModifierGroups,
  recipeComponents,
  restaurantSettings,
} from './restaurant.schema.js';

type Row = Record<string, unknown>;
const money = (minor: bigint | string) => Money.ofMinor(BigInt(minor), 'KWD').toJSON();

export const MODULE_DISABLED = () =>
  new AppError(409, 'MODULE_DISABLED', 'The restaurant module is not enabled for this company.');

/** Merchant-wide restaurant configuration needs a merchant-wide `restaurant.manage`. */
function assertMerchantWide(actor: MerchantActor) {
  if (!can(actor.access, 'restaurant.manage', null)) throw AppError.forbidden();
}

/**
 * Restaurant configuration (Prompt 15): the module switch, dining areas and tables,
 * kitchen stations with category routing (per branch), modifier groups, and per menu item
 * the modifier groups and recipes. The menu itself is the product catalog (ADR-0072).
 */
@Injectable()
export class RestaurantConfigService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async settingsIn(tx: Transaction): Promise<RestaurantSettings> {
    const [row] = await tx.select().from(restaurantSettings);
    return row
      ? { enabled: row.enabled, autoSendOnPayment: row.autoSendOnPayment, version: row.version }
      : { enabled: false, autoSendOnPayment: true, version: 0 };
  }

  async assertEnabled(tx: Transaction) {
    if (!(await this.settingsIn(tx)).enabled) throw MODULE_DISABLED();
  }

  settings(actor: MerchantActor) {
    return this.database.withMerchantTx(actor.merchantId, (tx) => this.settingsIn(tx));
  }

  async updateSettings(
    actor: MerchantActor,
    input: z.output<typeof updateRestaurantSettingsSchema>,
    ip: string,
  ): Promise<RestaurantSettings> {
    assertMerchantWide(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const current = await this.settingsIn(tx);
      if (current.version !== input.version) throw versionConflict();
      await tx
        .insert(restaurantSettings)
        .values({
          merchantId: actor.merchantId,
          enabled: input.enabled,
          autoSendOnPayment: input.autoSendOnPayment,
        })
        .onConflictDoUpdate({
          target: restaurantSettings.merchantId,
          set: {
            enabled: input.enabled,
            autoSendOnPayment: input.autoSendOnPayment,
            version: sql`${restaurantSettings.version} + 1`,
            updatedAt: sql`now()`,
          },
        });
      await this.record(tx, actor, 'restaurant.settings_updated', actor.merchantId, ip, {
        enabled: input.enabled,
      });
      return this.settingsIn(tx);
    });
  }

  // ------------------------------------------------------------ branch layout
  async layout(actor: MerchantActor, branchId: string): Promise<BranchLayout> {
    if (
      !can(actor.access, 'restaurant.manage', branchId) &&
      !can(actor.access, 'restaurant.orders', branchId)
    )
      throw AppError.forbidden();
    return this.database.withMerchantTx(actor.merchantId, (tx) => this.layoutIn(tx, branchId));
  }

  async layoutIn(tx: Transaction, branchId: string): Promise<BranchLayout> {
    const areas = await tx
      .select()
      .from(diningAreas)
      .where(eq(diningAreas.branchId, branchId))
      .orderBy(diningAreas.position, diningAreas.nameEn);
    const tables = await tx
      .select()
      .from(diningTables)
      .where(eq(diningTables.branchId, branchId))
      .orderBy(diningTables.position, diningTables.code);
    const stations = await tx
      .select()
      .from(kitchenStations)
      .where(eq(kitchenStations.branchId, branchId))
      .orderBy(kitchenStations.nameEn);
    const routes = await tx
      .select()
      .from(kitchenStationCategories)
      .where(eq(kitchenStationCategories.branchId, branchId));
    return {
      areas: areas.map((a) => ({
        id: a.id,
        branchId: a.branchId,
        nameEn: a.nameEn,
        nameAr: a.nameAr,
        position: a.position,
        status: a.status as 'active',
        version: a.version,
      })),
      tables: tables.map((t) => ({
        id: t.id,
        branchId: t.branchId,
        areaId: t.areaId,
        code: t.code,
        seats: t.seats,
        position: t.position,
        status: t.status as 'active',
        version: t.version,
      })),
      stations: stations.map((s) => ({
        id: s.id,
        branchId: s.branchId,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        isDefault: s.isDefault,
        status: s.status as 'active',
        categoryIds: routes.filter((r) => r.stationId === s.id).map((r) => r.categoryId),
        version: s.version,
      })),
    };
  }

  async saveArea(
    actor: MerchantActor,
    id: string | null,
    input: z.output<typeof saveDiningAreaSchema>,
    ip: string,
  ) {
    assertCan(actor, 'restaurant.manage', input.branchId);
    const areaId = id ?? newId();
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const { version, ...fields } = input;
      if (id) {
        const [row] = await tx
          .update(diningAreas)
          .set({ ...fields, version: sql`${diningAreas.version} + 1` })
          .where(
            and(
              eq(diningAreas.id, id),
              eq(diningAreas.version, version ?? -1),
              eq(diningAreas.branchId, input.branchId),
            ),
          )
          .returning({ id: diningAreas.id });
        if (!row) throw await this.missingOrConflict(tx, 'dining_areas', id);
      } else
        await tx
          .insert(diningAreas)
          .values({ id: areaId, merchantId: actor.merchantId, ...fields });
      await this.record(
        tx,
        actor,
        id ? 'restaurant.area_updated' : 'restaurant.area_created',
        areaId,
        ip,
      );
    });
    return this.layout(actor, input.branchId);
  }

  async saveTable(
    actor: MerchantActor,
    id: string | null,
    input: z.output<typeof saveDiningTableSchema>,
    ip: string,
  ) {
    const area = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [a] = await tx.select().from(diningAreas).where(eq(diningAreas.id, input.areaId));
      return a;
    });
    if (!area) throw AppError.notFound('Dining area not found.');
    assertCan(actor, 'restaurant.manage', area.branchId);
    const tableId = id ?? newId();
    try {
      await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const { version, ...fields } = input;
        if (id) {
          const [row] = await tx
            .update(diningTables)
            .set({ ...fields, version: sql`${diningTables.version} + 1` })
            .where(
              and(
                eq(diningTables.id, id),
                eq(diningTables.version, version ?? -1),
                eq(diningTables.branchId, area.branchId),
              ),
            )
            .returning({ id: diningTables.id });
          if (!row) throw await this.missingOrConflict(tx, 'dining_tables', id);
        } else
          await tx.insert(diningTables).values({
            id: tableId,
            merchantId: actor.merchantId,
            branchId: area.branchId,
            ...fields,
          });
        await this.record(
          tx,
          actor,
          id ? 'restaurant.table_updated' : 'restaurant.table_created',
          tableId,
          ip,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'dining_tables_code_key'))
        throw new AppError(409, 'DUPLICATE_CODE', 'Another table at this branch uses this code.', [
          {
            path: 'code',
            code: 'duplicate',
            message: 'Another table at this branch uses this code.',
          },
        ]);
      throw error;
    }
    return this.layout(actor, area.branchId);
  }

  async saveStation(
    actor: MerchantActor,
    id: string | null,
    input: z.output<typeof saveKitchenStationSchema>,
    ip: string,
  ) {
    assertCan(actor, 'restaurant.manage', input.branchId);
    const stationId = id ?? newId();
    try {
      await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const { version, categoryIds, ...fields } = input;
        if (id) {
          const [row] = await tx
            .update(kitchenStations)
            .set({ ...fields, version: sql`${kitchenStations.version} + 1` })
            .where(
              and(
                eq(kitchenStations.id, id),
                eq(kitchenStations.version, version ?? -1),
                eq(kitchenStations.branchId, input.branchId),
              ),
            )
            .returning({ id: kitchenStations.id });
          if (!row) throw await this.missingOrConflict(tx, 'kitchen_stations', id);
          await tx
            .delete(kitchenStationCategories)
            .where(eq(kitchenStationCategories.stationId, id));
        } else
          await tx
            .insert(kitchenStations)
            .values({ id: stationId, merchantId: actor.merchantId, ...fields });
        if (categoryIds.length)
          await tx.insert(kitchenStationCategories).values(
            [...new Set(categoryIds)].map((categoryId) => ({
              merchantId: actor.merchantId,
              stationId,
              branchId: input.branchId,
              categoryId,
            })),
          );
        await this.record(
          tx,
          actor,
          id ? 'restaurant.station_updated' : 'restaurant.station_created',
          stationId,
          ip,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'kitchen_station_categories_branch_key'))
        throw new AppError(
          409,
          'CONFLICT',
          'A category can be routed to only one station per branch.',
          [
            {
              path: 'categoryIds',
              code: 'duplicate',
              message: 'Already routed to another station.',
            },
          ],
        );
      if (isUniqueViolation(error, 'kitchen_stations_default_key'))
        throw new AppError(409, 'CONFLICT', 'This branch already has a default station.', [
          {
            path: 'isDefault',
            code: 'duplicate',
            message: 'This branch already has a default station.',
          },
        ]);
      throw error;
    }
    return this.layout(actor, input.branchId);
  }

  // ------------------------------------------------------------ modifiers & menu
  async groupsIn(tx: Transaction, activeOnly = false): Promise<ModifierGroup[]> {
    const groups = await tx
      .select()
      .from(modifierGroups)
      .orderBy(modifierGroups.nameEn, modifierGroups.nameAr);
    const mods = await tx.select().from(modifiers).orderBy(modifiers.position, modifiers.nameEn);
    return groups
      .filter((g) => !activeOnly || g.status === 'active')
      .map((g) => ({
        id: g.id,
        nameEn: g.nameEn,
        nameAr: g.nameAr,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        status: g.status as 'active',
        version: g.version,
        modifiers: mods
          .filter((m) => m.groupId === g.id && (!activeOnly || m.status === 'active'))
          .map((m) => ({
            id: m.id,
            nameEn: m.nameEn,
            nameAr: m.nameAr,
            price: money(m.priceMinor),
            position: m.position,
            status: m.status as 'active',
            componentVariantId: m.componentVariantId,
            componentQuantity:
              m.componentQuantity === null
                ? null
                : formatQuantity(parseQuantity(m.componentQuantity)),
          })),
      }));
  }

  async saveModifierGroup(
    actor: MerchantActor,
    id: string | null,
    input: z.output<typeof saveModifierGroupSchema>,
    ip: string,
  ): Promise<ModifierGroup> {
    assertMerchantWide(actor);
    const groupId = id ?? newId();
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const { version, modifiers: items, ...fields } = input;
      if (id) {
        const [row] = await tx
          .update(modifierGroups)
          .set({ ...fields, version: sql`${modifierGroups.version} + 1` })
          .where(and(eq(modifierGroups.id, id), eq(modifierGroups.version, version ?? -1)))
          .returning({ id: modifierGroups.id });
        if (!row) throw await this.missingOrConflict(tx, 'modifier_groups', id);
      } else
        await tx
          .insert(modifierGroups)
          .values({ id: groupId, merchantId: actor.merchantId, ...fields });
      const existing = await tx
        .select({ id: modifiers.id })
        .from(modifiers)
        .where(eq(modifiers.groupId, groupId));
      const known = new Set(existing.map((m) => m.id));
      for (const [position, m] of items.entries()) {
        const values = {
          nameEn: m.nameEn,
          nameAr: m.nameAr,
          priceMinor: parseAmount(m.price, `modifiers.${position}.price`),
          status: m.status,
          position,
          componentVariantId: m.componentVariantId,
          componentQuantity:
            m.componentQuantity === null
              ? null
              : formatQuantity(parseQuantity(m.componentQuantity)),
        };
        if (m.id && known.has(m.id))
          await tx.update(modifiers).set(values).where(eq(modifiers.id, m.id));
        else if (m.id) throw AppError.notFound('Modifier not found in this group.');
        else
          await tx
            .insert(modifiers)
            .values({ id: newId(), merchantId: actor.merchantId, groupId, ...values });
      }
      // Modifiers left out of the list are deactivated (never deleted: orders refer to them).
      const kept = new Set(items.flatMap((m) => (m.id ? [m.id] : [])));
      for (const m of existing)
        if (!kept.has(m.id))
          await tx.update(modifiers).set({ status: 'inactive' }).where(eq(modifiers.id, m.id));
      await this.record(
        tx,
        actor,
        id ? 'restaurant.modifiers_updated' : 'restaurant.modifiers_created',
        groupId,
        ip,
      );
      return (await this.groupsIn(tx)).find((g) => g.id === groupId)!;
    });
  }

  async menu(actor: MerchantActor): Promise<{ items: MenuItem[]; groups: ModifierGroup[] }> {
    if (!canAnywhere(actor.access, 'restaurant.manage')) throw AppError.forbidden();
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const products = (
        await tx.execute(sql`
          select p.id, p.name_en, p.name_ar, p.category_id, p.track_inventory,
                 coalesce((select array_agg(pg.group_id order by pg.position) from product_modifier_groups pg
                           where pg.product_id = p.id), '{}') as groups
          from products p where p.status = 'active'
          order by coalesce(lower(p.name_en), p.name_ar)`)
      ).rows as Row[];
      const variants = (
        await tx.execute(sql`
          select v.id, v.product_id, v.name_en, v.name_ar, v.sku, v.price_minor::text as price
          from product_variants v join products p on p.id = v.product_id
          where p.status = 'active' and v.status = 'active' order by v.created_at`)
      ).rows as Row[];
      const recipes = (
        await tx.execute(sql`
          select r.variant_id, r.component_variant_id, r.quantity::text as qty,
                 coalesce(p.name_en, p.name_ar) || coalesce(' — ' || coalesce(v.name_en, v.name_ar), '') as name
          from recipe_components r join product_variants v on v.id = r.component_variant_id
          join products p on p.id = v.product_id order by name`)
      ).rows as Row[];
      return {
        groups: await this.groupsIn(tx),
        items: products.map((p) => ({
          productId: p['id'] as string,
          nameEn: (p['name_en'] as string | null) ?? null,
          nameAr: (p['name_ar'] as string | null) ?? null,
          categoryId: (p['category_id'] as string | null) ?? null,
          trackInventory: p['track_inventory'] as boolean,
          modifierGroupIds: p['groups'] as string[],
          variants: variants
            .filter((v) => v['product_id'] === p['id'])
            .map((v) => ({
              id: v['id'] as string,
              nameEn: (v['name_en'] as string | null) ?? null,
              nameAr: (v['name_ar'] as string | null) ?? null,
              sku: (v['sku'] as string | null) ?? null,
              price: money(v['price'] as string),
              recipe: recipes
                .filter((r) => r['variant_id'] === v['id'])
                .map((r) => ({
                  componentVariantId: r['component_variant_id'] as string,
                  componentName: r['name'] as string,
                  quantity: formatQuantity(parseQuantity(r['qty'] as string)),
                })),
            })),
        })),
      };
    });
  }

  async saveMenuItem(
    actor: MerchantActor,
    productId: string,
    input: z.output<typeof saveMenuItemSchema>,
    ip: string,
  ) {
    assertMerchantWide(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [product] = (
        await tx.execute(sql`select id, track_inventory from products where id = ${productId}`)
      ).rows as { id: string; track_inventory: boolean }[];
      if (!product) throw AppError.notFound('Product not found.');
      const ownVariants = new Set(
        (
          (await tx.execute(sql`select id from product_variants where product_id = ${productId}`))
            .rows as {
            id: string;
          }[]
        ).map((v) => v.id),
      );
      const hasRecipe = input.recipes.some((r) => r.components.length > 0);
      // A recipe replaces the item's own stock: a tracked item with a recipe would be deducted twice.
      if (hasRecipe && product.track_inventory)
        throw new AppError(
          409,
          'INVALID_STATE',
          'Turn off stock tracking for this item before giving it a recipe.',
          [
            {
              path: 'recipes',
              code: 'tracked_item',
              message: 'Items with a recipe are not stock-tracked themselves.',
            },
          ],
        );
      for (const [i, r] of input.recipes.entries()) {
        if (!ownVariants.has(r.variantId))
          throw AppError.validation([
            {
              path: `recipes.${i}.variantId`,
              code: 'invalid',
              message: 'Not a variant of this item.',
            },
          ]);
        if (r.components.some((c) => ownVariants.has(c.componentVariantId)))
          throw AppError.validation([
            {
              path: `recipes.${i}.components`,
              code: 'invalid',
              message: 'An item cannot be its own ingredient.',
            },
          ]);
      }
      const componentIds = [
        ...new Set(input.recipes.flatMap((r) => r.components.map((c) => c.componentVariantId))),
      ];
      if (componentIds.length) {
        const tracked = (
          await tx.execute(sql`
            select v.id from product_variants v join products p on p.id = v.product_id
            where v.id in (${sql.join(
              componentIds.map((c) => sql`${c}`),
              sql`, `,
            )}) and p.track_inventory`)
        ).rows as { id: string }[];
        if (tracked.length !== componentIds.length)
          throw new AppError(409, 'NOT_STOCK_TRACKED', 'Ingredients must be stock-tracked items.');
      }
      await tx.delete(productModifierGroups).where(eq(productModifierGroups.productId, productId));
      if (input.modifierGroupIds.length)
        await tx.insert(productModifierGroups).values(
          [...new Set(input.modifierGroupIds)].map((groupId, position) => ({
            merchantId: actor.merchantId,
            productId,
            groupId,
            position,
          })),
        );
      for (const variantId of ownVariants)
        await tx.delete(recipeComponents).where(eq(recipeComponents.variantId, variantId));
      const rows = input.recipes.flatMap((r) =>
        r.components.map((c) => ({
          merchantId: actor.merchantId,
          variantId: r.variantId,
          componentVariantId: c.componentVariantId,
          quantity: formatQuantity(parseQuantity(c.quantity)),
        })),
      );
      if (rows.length) await tx.insert(recipeComponents).values(rows);
      await this.record(tx, actor, 'restaurant.menu_item_updated', productId, ip, {
        groups: input.modifierGroupIds.length,
        recipeLines: rows.length,
      });
    });
    return this.menu(actor);
  }

  async posMenu(actor: MerchantActor): Promise<PosMenu> {
    const branchId = actor.boundBranchId;
    if (!branchId || !can(actor.access, 'restaurant.orders', branchId)) throw AppError.forbidden();
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await this.assertEnabled(tx);
      const links = await tx
        .select()
        .from(productModifierGroups)
        .orderBy(productModifierGroups.position);
      const groups = (await this.groupsIn(tx, true)).filter((g) => g.modifiers.length > 0);
      const active = new Set(groups.map((g) => g.id));
      const productGroups: Record<string, string[]> = {};
      for (const l of links)
        if (active.has(l.groupId)) (productGroups[l.productId] ??= []).push(l.groupId);
      return { groups, productGroups };
    });
  }

  // ------------------------------------------------------------ helpers
  private async missingOrConflict(tx: Transaction, table: string, id: string): Promise<AppError> {
    const [exists] = (
      await tx.execute(sql`select 1 from ${sql.identifier(table)} where id = ${id}`)
    ).rows;
    return exists ? versionConflict() : AppError.notFound();
  }

  record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    id: string,
    ip: string,
    details: Row = {},
  ) {
    return this.audit.recordIn(tx, {
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action,
      targetType: 'restaurant',
      targetId: id,
      ip,
      details,
    });
  }
}
