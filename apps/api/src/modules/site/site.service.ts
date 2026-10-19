import {
  type PublicSiteApp,
  type PublicSiteApps,
  type SiteApp,
  saveSiteAppSchema,
} from '@arabat/contracts';
import { Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import type { PlatformActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { siteApps } from './site.schema.js';

type O<T extends z.ZodType> = z.output<T>;
type Row = typeof siteApps.$inferSelect;

const versionConflict = () =>
  new AppError(409, 'VERSION_CONFLICT', 'This record was changed by someone else. Reload it.');

function toPublic(r: Row): PublicSiteApp {
  return {
    id: r.id,
    nameAr: r.nameAr,
    nameEn: r.nameEn,
    descriptionAr: r.descriptionAr,
    descriptionEn: r.descriptionEn,
    url: r.url,
    icon: r.icon as PublicSiteApp['icon'],
    openInNewTab: r.openInNewTab,
  };
}

function toApp(r: Row): SiteApp {
  return {
    ...toPublic(r),
    status: r.status as SiteApp['status'],
    sortOrder: r.sortOrder,
    version: r.version,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** The "Our apps" menu of the public site (ADR-0117): a global list kept by operators. */
@Injectable()
export class SiteService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async publicApps(): Promise<PublicSiteApps> {
    const rows = await this.database.db
      .select()
      .from(siteApps)
      .where(eq(siteApps.status, 'active'))
      .orderBy(asc(siteApps.sortOrder), asc(siteApps.nameEn));
    return { apps: rows.map(toPublic) };
  }

  async apps(): Promise<SiteApp[]> {
    const rows = await this.database.db
      .select()
      .from(siteApps)
      .orderBy(asc(siteApps.sortOrder), asc(siteApps.nameEn));
    return rows.map(toApp);
  }

  async save(
    actor: PlatformActor,
    id: string | null,
    input: O<typeof saveSiteAppSchema>,
    ip: string,
  ): Promise<SiteApp> {
    const values = {
      nameAr: input.nameAr,
      nameEn: input.nameEn,
      descriptionAr: input.descriptionAr,
      descriptionEn: input.descriptionEn,
      url: input.url,
      icon: input.icon,
      openInNewTab: input.openInNewTab,
      status: input.status,
      sortOrder: input.sortOrder,
    };
    const saved = await this.database.withPlatformContext(actor.operatorId, null, async (tx) => {
      if (id === null) {
        const [row] = await tx
          .insert(siteApps)
          .values({ id: newId(), ...values })
          .returning();
        await this.record(tx, actor, 'site.app.created', row!.id, ip, values);
        return row!;
      }
      const current = await this.lock(tx, id);
      if (current.version !== input.version) throw versionConflict();
      const [row] = await tx
        .update(siteApps)
        .set({ ...values, version: sql`${siteApps.version} + 1`, updatedAt: sql`now()` })
        .where(eq(siteApps.id, id))
        .returning();
      await this.record(tx, actor, 'site.app.updated', id, ip, {
        ...values,
        previousUrl: current.url,
        previousStatus: current.status,
      });
      return row!;
    });
    return toApp(saved);
  }

  async remove(actor: PlatformActor, id: string, ip: string): Promise<void> {
    await this.database.withPlatformContext(actor.operatorId, null, async (tx) => {
      const current = await this.lock(tx, id);
      await tx.delete(siteApps).where(eq(siteApps.id, id));
      await this.record(tx, actor, 'site.app.deleted', id, ip, {
        nameAr: current.nameAr,
        nameEn: current.nameEn,
        url: current.url,
        status: current.status,
      });
    });
  }

  private async lock(tx: Transaction, id: string): Promise<Row> {
    const [row] = await tx.select().from(siteApps).where(eq(siteApps.id, id)).for('update');
    if (!row) throw AppError.notFound('App not found.');
    return row;
  }

  private record(
    tx: Transaction,
    actor: PlatformActor,
    action: string,
    targetId: string,
    ip: string,
    details: Record<string, unknown>,
  ) {
    return this.audit.recordIn(tx, {
      merchantId: null,
      actorType: 'operator',
      actorId: actor.operatorId,
      action,
      targetType: 'site_app',
      targetId,
      ip,
      details: { ...details, operatorRole: actor.role },
    });
  }
}
