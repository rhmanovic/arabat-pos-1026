import type { StoreAddresses, StoreDomain, StoreDomainStatus } from '@arabat/contracts';
import { can } from '@arabat/permissions';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { CustomHostnames, type CustomHostname } from '../../kernel/domains/custom-hostnames.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { domainAddress, storeAddress } from '../../kernel/http/store-host.js';
import { newId } from '../../kernel/ids.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { AuditService } from '../audit/audit.service.js';
import { onlineStores } from './ecommerce.schema.js';
import { storeDomains } from './store-domains.schema.js';

/*
 * Merchants' own domains (ADR-0137). The merchant buys a domain anywhere, types it in the
 * console and adds one CNAME (`www` → the platform target) at their DNS provider; everything
 * else happens here: Cloudflare custom hostnames for `www.{domain}` and `{domain}`, their
 * checks and certificates (issued and renewed by Cloudflare), the status shown to the
 * merchant, the main address. Nobody at Arabat acts per merchant.
 */

/** A domain whose records never appeared is released after this long (nobody holds a name). */
const PENDING_DAYS = 7;

type HostView = StoreDomain['www'];
type DomainState = {
  www?: CustomHostname | null;
  root?: CustomHostname | null;
  /** The provider could not be reached on the last check. */
  error?: string | null;
  /** The domain was the main address before it stopped working; it is again once it works. */
  wasPrimary?: boolean;
};
type DomainRow = typeof storeDomains.$inferSelect;

const hostView = (hostname: string, h: CustomHostname | null | undefined): HostView => ({
  hostname,
  status: h?.status ?? 'pending',
  certificate: h?.certificate ?? 'pending',
  errors: h?.errors ?? [],
});

/** The domain's status from its `www` host name, which shoppers use. */
function statusOf(state: DomainState): Exclude<StoreDomainStatus, 'removed'> {
  const www = state.www;
  if (!www) return 'pending';
  if (www.status === 'failed' || www.certificate === 'failed') return 'failed';
  if (www.status === 'active' && www.certificate === 'active') return 'active';
  return www.status === 'active' ? 'verifying' : 'pending';
}

@Injectable()
export class StoreDomainsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StoreDomainsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly hostnames: CustomHostnames,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    // Waiting domains are checked every few minutes, working ones daily (not in tests).
    if (this.env.NODE_ENV === 'test' || !this.hostnames.available) return;
    this.timer = setInterval(
      () => void this.refreshDue().catch((e) => this.logger.error(e)),
      60_000,
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private assertManage(actor: MerchantActor) {
    if (!can(actor.access, 'online.manage', null)) throw AppError.forbidden();
  }

  // ------------------------------------------------------------------ reading
  async addresses(actor: MerchantActor): Promise<StoreAddresses> {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [store] = await tx
        .select({ slug: onlineStores.slug, code: onlineStores.publicCode })
        .from(onlineStores);
      if (!store) throw new AppError(409, 'STORE_NOT_SAVED', 'Save the store settings first.');
      return this.view(store, await this.current(tx));
    });
  }

  private current(tx: Transaction): Promise<DomainRow | undefined> {
    return tx
      .select()
      .from(storeDomains)
      .where(ne(storeDomains.status, 'removed'))
      .then((rows) => rows[0]);
  }

  private view(store: { slug: string; code: string }, row: DomainRow | undefined): StoreAddresses {
    const storeUrl = storeAddress(this.env, store.slug);
    const target = this.hostnames.target;
    const domain = row ? this.domainView(row, target) : null;
    return {
      available: this.hostnames.available,
      code: store.code,
      permanentUrl: this.env.STORE_DOMAIN ? storeAddress(this.env, store.code) : null,
      storeUrl,
      primaryUrl: row?.isPrimary ? domainAddress(this.env, row.domain) : storeUrl,
      target,
      domain,
    };
  }

  private domainView(row: DomainRow, target: string | null): StoreDomain {
    const state = row.state as DomainState;
    const txt = [...(state.www?.txt ?? []), ...(state.root?.txt ?? [])];
    return {
      domain: row.domain,
      status: row.status as StoreDomainStatus,
      isPrimary: row.isPrimary,
      www: hostView(`www.${row.domain}`, state.www),
      root: hostView(row.domain, state.root),
      records: [
        { type: 'CNAME', name: 'www', value: target ?? '', purpose: 'required' as const },
        { type: 'CNAME', name: '@', value: target ?? '', purpose: 'root' as const },
        ...txt.map((r) => ({
          type: 'TXT',
          name: r.name,
          value: r.value,
          purpose: 'verify' as const,
        })),
      ],
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      activatedAt: row.activatedAt?.toISOString() ?? null,
    };
  }

  // ------------------------------------------------------------------ changes
  async connect(actor: MerchantActor, domain: string, ip: string): Promise<StoreAddresses> {
    this.assertManage(actor);
    if (!this.hostnames.available)
      throw new AppError(
        503,
        'DOMAINS_UNAVAILABLE',
        'Connecting your own domain is not available yet.',
      );
    if (this.isPlatformDomain(domain))
      throw new AppError(422, 'DOMAIN_NOT_ALLOWED', 'This domain belongs to Arabat.');
    try {
      await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const [store] = await tx.select({ slug: onlineStores.slug }).from(onlineStores);
        if (!store) throw new AppError(409, 'STORE_NOT_SAVED', 'Save the store settings first.');
        if (await this.current(tx))
          throw new AppError(409, 'DOMAIN_ALREADY_CONNECTED', 'Remove the connected domain first.');
        const id = newId();
        await tx.insert(storeDomains).values({ id, merchantId: actor.merchantId, domain });
        await this.record(tx, actor.merchantId, actor, 'online.domain_connected', id, ip, {
          domain,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error, 'store_domains_domain_key'))
        throw new AppError(409, 'DOMAIN_TAKEN', 'This domain is connected to another store.');
      if (isUniqueViolation(error, 'store_domains_merchant_key'))
        throw new AppError(409, 'DOMAIN_ALREADY_CONNECTED', 'Remove the connected domain first.');
      throw error;
    }
    await this.refresh(actor.merchantId);
    return this.addresses(actor);
  }

  /** "Check the connection": reads Cloudflare now instead of waiting for the next round. */
  async check(actor: MerchantActor): Promise<StoreAddresses> {
    this.assertManage(actor);
    if (!this.hostnames.available)
      throw new AppError(
        503,
        'DOMAINS_UNAVAILABLE',
        'Connecting your own domain is not available yet.',
      );
    const found = await this.database.withMerchantTx(actor.merchantId, (tx) => this.current(tx));
    if (!found) throw AppError.notFound('No domain is connected.');
    await this.refresh(actor.merchantId);
    return this.addresses(actor);
  }

  async setPrimary(actor: MerchantActor, primary: boolean, ip: string): Promise<StoreAddresses> {
    this.assertManage(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const row = await this.current(tx);
      if (!row) throw AppError.notFound('No domain is connected.');
      if (primary && row.status !== 'active')
        throw new AppError(
          409,
          'DOMAIN_NOT_ACTIVE',
          'The domain works once its records are in place.',
        );
      await tx
        .update(storeDomains)
        .set({
          isPrimary: primary,
          state: { ...(row.state as DomainState), wasPrimary: false },
          updatedAt: new Date(),
        })
        .where(eq(storeDomains.id, row.id));
      await this.record(tx, actor.merchantId, actor, 'online.domain_primary', row.id, ip, {
        domain: row.domain,
        primary,
      });
    });
    return this.addresses(actor);
  }

  async remove(actor: MerchantActor, ip: string): Promise<StoreAddresses> {
    this.assertManage(actor);
    const row = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const found = await this.current(tx);
      if (!found) throw AppError.notFound('No domain is connected.');
      await this.release(tx, found);
      await this.record(tx, actor.merchantId, actor, 'online.domain_removed', found.id, ip, {
        domain: found.domain,
      });
      return found;
    });
    await this.dropHostnames(row);
    return this.addresses(actor);
  }

  private release(tx: Transaction, row: DomainRow) {
    return tx
      .update(storeDomains)
      .set({ status: 'removed', isPrimary: false, removedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(storeDomains.id, row.id), ne(storeDomains.status, 'removed')));
  }

  private async dropHostnames(row: DomainRow) {
    if (!this.hostnames.available) return;
    for (const id of [row.wwwHostnameId, row.rootHostnameId])
      if (id)
        await this.hostnames
          .remove(id)
          .catch((e: Error) => this.logger.warn(`Removing custom hostname ${id}: ${e.message}`));
  }

  // ------------------------------------------------------------------ checks
  async refreshDue(): Promise<void> {
    const due = (await this.database.db.execute(sql`select store_domains_due_merchants() as m`))
      .rows as { m: string }[];
    for (const { m } of due)
      await this.refresh(m).catch((e: Error) =>
        this.logger.warn(`Domain check ${m}: ${e.message}`),
      );
  }

  /**
   * Reads (and creates when missing) both host names at Cloudflare, then stores what it saw:
   * the status, the first activation (which makes the domain the main address), a main
   * address lost while the domain does not work and given back when it works again, and the
   * release of a domain whose records never appeared.
   */
  async refresh(merchantId: string): Promise<void> {
    const row = await this.database.withMerchantTx(merchantId, (tx) => this.current(tx));
    if (!row || !this.hostnames.available) return;
    const before = row.state as DomainState;
    const state: DomainState = { wasPrimary: before.wasPrimary ?? false, error: null };
    let wwwId = row.wwwHostnameId;
    let rootId = row.rootHostnameId;
    try {
      state.www = await this.hostname(wwwId, `www.${row.domain}`);
      wwwId = state.www.id;
      state.root = await this.hostname(rootId, row.domain);
      rootId = state.root.id;
    } catch (error) {
      state.www ??= before.www ?? null;
      state.root ??= before.root ?? null;
      state.error = (error as Error).message;
    }
    const status = statusOf(state);
    const expired =
      status !== 'active' &&
      !row.activatedAt &&
      row.createdAt.getTime() < Date.now() - PENDING_DAYS * 86_400_000;
    await this.database.withMerchantTx(merchantId, async (tx) => {
      if (expired) {
        await this.release(tx, row);
        await this.record(tx, merchantId, null, 'online.domain_expired', row.id, null, {
          domain: row.domain,
        });
        return;
      }
      const firstTime = status === 'active' && !row.activatedAt;
      let isPrimary = row.isPrimary;
      if (status !== 'active' && row.isPrimary) {
        isPrimary = false;
        state.wasPrimary = true;
      } else if (status === 'active' && (firstTime || state.wasPrimary)) {
        isPrimary = true;
        state.wasPrimary = false;
      }
      await tx
        .update(storeDomains)
        .set({
          status,
          state,
          wwwHostnameId: wwwId,
          rootHostnameId: rootId,
          isPrimary,
          lastCheckedAt: new Date(),
          activatedAt: row.activatedAt ?? (status === 'active' ? new Date() : null),
          updatedAt: new Date(),
        })
        .where(eq(storeDomains.id, row.id));
      if (status !== row.status)
        await this.record(tx, merchantId, null, 'online.domain_status', row.id, null, {
          domain: row.domain,
          from: row.status,
          to: status,
        });
    });
    if (expired) await this.dropHostnames(row);
  }

  private async hostname(id: string | null, name: string): Promise<CustomHostname> {
    const found = id ? await this.hostnames.get(id) : null;
    return found ?? this.hostnames.create(name);
  }

  private isPlatformDomain(domain: string): boolean {
    const own = [
      this.env.STORE_DOMAIN,
      ...[this.env.PUBLIC_MANAGER_URL, this.env.PUBLIC_STORE_URL].map((u) =>
        new URL(u).hostname.replace(/^www\./, ''),
      ),
    ].filter(Boolean);
    return own.some((d) => domain === d || domain.endsWith(`.${d}`));
  }

  private record(
    tx: Transaction,
    merchantId: string,
    actor: MerchantActor | null,
    action: string,
    id: string,
    ip: string | null,
    details: Record<string, unknown>,
  ) {
    return this.audit.recordIn(tx, {
      merchantId,
      actorType: actor ? 'user' : 'system',
      actorId: actor?.userId ?? null,
      action,
      targetType: 'store_domain',
      targetId: id,
      ip,
      details,
    });
  }
}
