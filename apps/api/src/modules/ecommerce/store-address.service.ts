import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DatabaseService } from '../../database/database.service.js';
import { domainAddress, storeAddress } from '../../kernel/http/store-host.js';

export type PublicAddress = { merchantId: string; slug: string; code: string; url: string };

/**
 * Where shoppers reach a store (ADR-0136, ADR-0137): its own domain when one is connected and
 * chosen as the main address, else its sub-domain (or `/store/{slug}`). Every link to a store
 * (console, payment returns, e-mails, link previews, redirects) comes from here.
 */
@Injectable()
export class StoreAddressService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** A public store by any of its addresses (current or recent slug) or its permanent code. */
  async find(key: string): Promise<PublicAddress | null> {
    const [row] = (
      await this.database.db.execute(
        sql`select merchant_id, slug, public_code, domain from store_public_address(${key})`,
      )
    ).rows as { merchant_id: string; slug: string; public_code: string; domain: string | null }[];
    if (!row) return null;
    return {
      merchantId: row.merchant_id,
      slug: row.slug,
      code: row.public_code,
      url: row.domain ? domainAddress(this.env, row.domain) : storeAddress(this.env, row.slug),
    };
  }

  /**
   * The store a connected domain stands for (`www.` stripped), and where its shoppers belong:
   * the domain itself when it is the main address, else the store's main address.
   */
  async byDomain(
    domain: string,
  ): Promise<{ slug: string; isPrimary: boolean; url: string } | null> {
    const [row] = (
      await this.database.db.execute(
        sql`select slug, is_primary from store_domain_store(${domain})`,
      )
    ).rows as { slug: string; is_primary: boolean }[];
    if (!row) return null;
    return {
      slug: row.slug,
      isPrimary: row.is_primary,
      url: row.is_primary ? domainAddress(this.env, domain) : await this.of(row.slug),
    };
  }

  /** The main address of a store, without a trailing slash (a draft store: its own address). */
  async of(slug: string): Promise<string> {
    return (await this.find(slug))?.url ?? storeAddress(this.env, slug);
  }
}
