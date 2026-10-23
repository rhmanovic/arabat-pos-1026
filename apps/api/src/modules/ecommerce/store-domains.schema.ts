import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, updatedAt } from '../../database/schema/columns.js';
import { merchants } from '../merchants/merchants.schema.js';

/**
 * A store's own domain (ADR-0137): bought by the merchant anywhere, connected by the merchant
 * from the console. Arabat registers `www.{domain}` and `{domain}` as Cloudflare custom
 * hostnames (certificate issued and renewed there); the merchant adds a CNAME at their DNS
 * provider. A domain is tied to the store (merchant), never to its address, so renaming the
 * store changes nothing. Removed domains are kept (`removed_at`), never deleted.
 */
export const storeDomains = pgTable(
  'store_domains',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    /** The domain as bought, lower case, without `www.` (e.g. `raghefkarak.com`). */
    domain: text().notNull(),
    /** pending (records not seen yet) | verifying (certificate on its way) | active | failed | removed. */
    status: text().notNull().default('pending'),
    /** Cloudflare custom hostname ids of `www.{domain}` and of `{domain}`. */
    wwwHostnameId: text(),
    rootHostnameId: text(),
    /** Last state read from Cloudflare: { www: {status, ssl, errors}, root: {…} }. */
    state: jsonb().notNull().default({}),
    /** The shoppers' main address is this domain (else the Arabat address). */
    isPrimary: boolean().notNull().default(false),
    lastCheckedAt: timestamp({ withTimezone: true }),
    activatedAt: timestamp({ withTimezone: true }),
    removedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // A domain belongs to one store at a time; a store connects one domain at a time.
    uniqueIndex('store_domains_domain_key')
      .on(t.domain)
      .where(sql`${t.status} <> 'removed'`),
    uniqueIndex('store_domains_merchant_key')
      .on(t.merchantId)
      .where(sql`${t.status} <> 'removed'`),
    index('store_domains_status_idx').on(t.status),
    check(
      'store_domains_status_valid',
      sql`${t.status} in ('pending', 'verifying', 'active', 'failed', 'removed')`,
    ),
    check(
      'store_domains_domain_valid',
      sql`${t.domain} ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$' and ${t.domain} not like 'www.%'`,
    ),
    check(
      'store_domains_removed_valid',
      sql`(${t.status} = 'removed') = (${t.removedAt} is not null)`,
    ),
    check('store_domains_primary_valid', sql`not ${t.isPrimary} or ${t.status} = 'active'`),
  ],
);
