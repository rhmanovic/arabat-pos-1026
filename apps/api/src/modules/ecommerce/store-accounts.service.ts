import type {
  AccountOrderList,
  AccountSession,
  AccountView,
  CustomerAccount,
  CustomerAddress,
  accountLoginSchema,
  accountPasswordSchema,
  accountRegisterSchema,
  accountResetSchema,
  accountUpdateSchema,
  saveCustomerAddressSchema,
} from '@arabat/contracts';
import { normalizePhone } from '@arabat/contracts';
import { Money, formatQuantity, parseQuantity } from '@arabat/money';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { nextDocumentNumber } from '../../database/schema/sequences.schema.js';
import { generateToken, hashToken } from '../../kernel/crypto/tokens.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { Mailer } from '../../kernel/mail/mailer.js';
import { renderEmail } from '../../kernel/mail/template.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { customers } from '../customers/customers.schema.js';

type Row = Record<string, unknown>;
const CURRENCY = 'KWD' as const;
const money = (minor: bigint | string) => Money.ofMinor(BigInt(minor), CURRENCY).toJSON();
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const str = (v: unknown) => (v as string | null) ?? null;

/** Sessions live this long without use; resets this long. */
const SESSION_DAYS = 90;
const RESET_MINUTES = 60;

/** Who is signed in to a store: resolved from the bearer token before any merchant context. */
export type StoreCustomer = {
  merchantId: string;
  accountId: string;
  customerId: string;
  sessionId: string;
};

const badCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'The e-mail or password is not right.');

/**
 * Shopper accounts (ADR-0124): e-mail + password sign-in attached to the merchant's customer
 * record (by phone), bearer sessions kept hashed, saved addresses, the shopper's orders, and a
 * password reset by e-mail. Guests keep ordering without an account.
 */
@Injectable()
export class StoreAccountsService {
  private readonly logger = new Logger(StoreAccountsService.name);
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Waits for background e-mails (tests). */
  async drain() {
    await Promise.all([...this.pending]);
  }

  /** The signed-in shopper of a bearer token, or null; the session's last use is stamped. */
  async resolve(authorization: string | undefined): Promise<StoreCustomer | null> {
    const token = /^Bearer\s+(st_[A-Za-z0-9_-]{20,})$/i.exec(authorization ?? '')?.[1];
    if (!token) return null;
    const [row] = (
      await this.database.db.execute(
        sql`select * from customer_session_lookup(${hashToken(token.slice(3))})`,
      )
    ).rows as Row[];
    if (!row?.['merchant_id']) return null;
    return {
      merchantId: row['merchant_id'] as string,
      accountId: row['account_id'] as string,
      customerId: row['customer_id'] as string,
      sessionId: row['session_id'] as string,
    };
  }

  /** The shopper must belong to the store they are talking to. */
  assertStore(customer: StoreCustomer | null, merchantId: string): StoreCustomer {
    if (!customer || customer.merchantId !== merchantId)
      throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to your account.');
    return customer;
  }

  private async accountView(tx: Transaction, accountId: string): Promise<CustomerAccount> {
    const [a] = (
      await tx.execute(sql`
        select a.id, a.email, a.created_at, c.full_name, c.phone
        from customer_accounts a join customers c on c.id = a.customer_id where a.id = ${accountId}`)
    ).rows as Row[];
    if (!a) throw AppError.notFound('Account not found.');
    return {
      id: a['id'] as string,
      fullName: a['full_name'] as string,
      phone: (a['phone'] as string | null) ?? '',
      email: a['email'] as string,
      createdAt: iso(a['created_at'])!,
    };
  }

  private async openSession(tx: Transaction, merchantId: string, accountId: string) {
    const token = generateToken();
    await tx.execute(sql`
      insert into customer_sessions (id, merchant_id, account_id, token_hash, expires_at)
      values (${newId()}, ${merchantId}, ${accountId}, ${hashToken(token)}, now() + make_interval(days => ${SESSION_DAYS}))`);
    await tx.execute(
      sql`update customer_accounts set last_login_at = now(), updated_at = now() where id = ${accountId}`,
    );
    return `st_${token}`;
  }

  async register(
    merchantId: string,
    input: z.output<typeof accountRegisterSchema>,
    ip: string,
  ): Promise<AccountSession> {
    const phone = normalizePhone(input.phone);
    if (!phone)
      throw AppError.validation([
        { path: 'phone', code: 'invalid', message: 'Enter a valid phone number.' },
      ]);
    const passwordHash = await this.passwords.hash(input.password);
    return this.database.withMerchantTx(merchantId, async (tx) => {
      const [store] = (await tx.execute(sql`select accounts_enabled from online_stores`))
        .rows as Row[];
      if (!store?.['accounts_enabled'])
        throw new AppError(409, 'ACCOUNTS_DISABLED', 'This store does not offer accounts.');
      const [taken] = (
        await tx.execute(sql`select 1 from customer_accounts where lower(email) = ${input.email}`)
      ).rows;
      if (taken)
        throw new AppError(409, 'EMAIL_TAKEN', 'An account with this e-mail already exists.', [
          { path: 'email', code: 'duplicate', message: 'Already registered.' },
        ]);
      // The account attaches to the customer with this phone (the till's record), or a new one.
      const [existing] = (await tx.execute(sql`select id from customers where phone = ${phone}`))
        .rows as { id: string }[];
      let customerId = existing?.id ?? null;
      if (customerId) {
        const [linked] = (
          await tx.execute(sql`select 1 from customer_accounts where customer_id = ${customerId}`)
        ).rows;
        if (linked)
          throw new AppError(409, 'PHONE_TAKEN', 'An account with this phone already exists.', [
            { path: 'phone', code: 'duplicate', message: 'Already registered.' },
          ]);
        await tx.execute(
          sql`update customers set full_name = ${input.fullName}, email = coalesce(email, ${input.email}), updated_at = now() where id = ${customerId}`,
        );
      } else {
        customerId = newId();
        const code = await nextDocumentNumber(tx, merchantId, 'customer', 'C');
        await tx.insert(customers).values({
          id: customerId,
          merchantId,
          code,
          fullName: input.fullName,
          phone,
          email: input.email,
        });
      }
      const accountId = newId();
      await tx.execute(sql`
        insert into customer_accounts (id, merchant_id, customer_id, email, password_hash)
        values (${accountId}, ${merchantId}, ${customerId}, ${input.email}, ${passwordHash})`);
      const token = await this.openSession(tx, merchantId, accountId);
      await this.record(tx, merchantId, 'online.account_registered', accountId, ip, {
        email: input.email,
      });
      return { token, account: await this.accountView(tx, accountId) };
    });
  }

  async login(
    merchantId: string,
    input: z.output<typeof accountLoginSchema>,
    ip: string,
  ): Promise<AccountSession> {
    const found = await this.database.withMerchantTx(merchantId, async (tx) => {
      const [a] = (
        await tx.execute(
          sql`select id, password_hash, status from customer_accounts where lower(email) = ${input.email}`,
        )
      ).rows as Row[];
      return a ?? null;
    });
    const ok = await this.passwords.verify(
      (found?.['password_hash'] as string | undefined) ?? null,
      input.password,
    );
    if (!found || !ok || found['status'] !== 'active') throw badCredentials();
    const accountId = found['id'] as string;
    return this.database.withMerchantTx(merchantId, async (tx) => {
      const token = await this.openSession(tx, merchantId, accountId);
      await this.record(tx, merchantId, 'online.account_login', accountId, ip, {});
      return { token, account: await this.accountView(tx, accountId) };
    });
  }

  async logout(customer: StoreCustomer) {
    await this.database.withMerchantTx(customer.merchantId, (tx) =>
      tx.execute(
        sql`update customer_sessions set revoked_at = now() where id = ${customer.sessionId}`,
      ),
    );
  }

  async me(customer: StoreCustomer): Promise<AccountView> {
    return this.database.withMerchantTx(customer.merchantId, async (tx) => ({
      account: await this.accountView(tx, customer.accountId),
      addresses: await this.addressRows(tx, customer.customerId),
    }));
  }

  async update(
    customer: StoreCustomer,
    input: z.output<typeof accountUpdateSchema>,
    ip: string,
  ): Promise<AccountView> {
    const phone = normalizePhone(input.phone);
    if (!phone)
      throw AppError.validation([
        { path: 'phone', code: 'invalid', message: 'Enter a valid phone number.' },
      ]);
    await this.database.withMerchantTx(customer.merchantId, async (tx) => {
      const [other] = (
        await tx.execute(
          sql`select 1 from customers where phone = ${phone} and id <> ${customer.customerId}`,
        )
      ).rows;
      if (other)
        throw new AppError(409, 'PHONE_TAKEN', 'Another customer uses this phone.', [
          { path: 'phone', code: 'duplicate', message: 'Already used.' },
        ]);
      await tx.execute(
        sql`update customers set full_name = ${input.fullName}, phone = ${phone}, updated_at = now() where id = ${customer.customerId}`,
      );
      await this.record(
        tx,
        customer.merchantId,
        'online.account_updated',
        customer.accountId,
        ip,
        {},
      );
    });
    return this.me(customer);
  }

  async changePassword(
    customer: StoreCustomer,
    input: z.output<typeof accountPasswordSchema>,
    ip: string,
  ) {
    const [row] = (
      await this.database.withMerchantTx(
        customer.merchantId,
        async (tx) =>
          (
            await tx.execute(
              sql`select password_hash from customer_accounts where id = ${customer.accountId}`,
            )
          ).rows,
      )
    ).map((r) => r as Row);
    if (!(await this.passwords.verify((row?.['password_hash'] as string) ?? null, input.current)))
      throw badCredentials();
    const hash = await this.passwords.hash(input.next);
    await this.database.withMerchantTx(customer.merchantId, async (tx) => {
      await tx.execute(
        sql`update customer_accounts set password_hash = ${hash}, updated_at = now() where id = ${customer.accountId}`,
      );
      // Other devices sign out; this session stays.
      await tx.execute(
        sql`update customer_sessions set revoked_at = now() where account_id = ${customer.accountId} and id <> ${customer.sessionId} and revoked_at is null`,
      );
      await this.record(
        tx,
        customer.merchantId,
        'online.account_password_changed',
        customer.accountId,
        ip,
        {},
      );
    });
  }

  /** Always answers the same way; the e-mail goes out only when the account exists. */
  async forgot(merchantId: string, slug: string, email: string, ip: string) {
    const token = generateToken();
    const sent = await this.database.withMerchantTx(merchantId, async (tx) => {
      const [a] = (
        await tx.execute(sql`
          select a.id, c.full_name, st.name_ar, st.name_en from customer_accounts a
          join customers c on c.id = a.customer_id join online_stores st on st.merchant_id = a.merchant_id
          where lower(a.email) = ${email} and a.status = 'active'`)
      ).rows as Row[];
      if (!a) return null;
      await tx.execute(sql`
        insert into customer_password_resets (id, merchant_id, account_id, token_hash, expires_at)
        values (${newId()}, ${merchantId}, ${a['id']}, ${hashToken(token)}, now() + make_interval(mins => ${RESET_MINUTES}))`);
      await this.record(
        tx,
        merchantId,
        'online.account_reset_requested',
        a['id'] as string,
        ip,
        {},
      );
      return {
        name: a['full_name'] as string,
        store: (str(a['name_ar']) ?? str(a['name_en']) ?? '') as string,
      };
    });
    if (!sent) return;
    const url = `${this.env.PUBLIC_STORE_URL.replace(/\/$/, '')}/${slug}/account/reset/${token}`;
    const job: Promise<void> = this.mailer
      .send({
        to: email,
        ...renderEmail({
          title: {
            ar: `إعادة تعيين كلمة المرور — ${sent.store}`,
            en: `Reset your password — ${sent.store}`,
          },
          name: sent.name,
          intro: {
            ar: 'طلبت إعادة تعيين كلمة مرور حسابك في المتجر. اضغط الزر لاختيار كلمة مرور جديدة.',
            en: 'You asked to reset the password of your store account. Press the button to choose a new one.',
          },
          action: { label: { ar: 'إعادة التعيين', en: 'Reset password' }, url },
          note: {
            ar: `الرابط صالح لمدة ${RESET_MINUTES} دقيقة. إن لم تطلب ذلك فتجاهل الرسالة.`,
            en: `The link works for ${RESET_MINUTES} minutes. Ignore this message if you did not ask.`,
          },
        }),
      })
      .catch((error: unknown) =>
        this.logger.error(`Reset e-mail to ${email} failed: ${(error as Error).message}`),
      )
      .finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  async reset(merchantId: string, input: z.output<typeof accountResetSchema>, ip: string) {
    const hash = await this.passwords.hash(input.password);
    await this.database.withMerchantTx(merchantId, async (tx) => {
      const [r] = (
        await tx.execute(sql`
          select id, account_id from customer_password_resets
          where token_hash = ${hashToken(input.token)} and used_at is null and expires_at > now() for update`)
      ).rows as Row[];
      if (!r)
        throw new AppError(400, 'RESET_TOKEN_INVALID', 'This reset link is not valid any more.');
      await tx.execute(
        sql`update customer_password_resets set used_at = now() where id = ${r['id']}`,
      );
      await tx.execute(
        sql`update customer_accounts set password_hash = ${hash}, updated_at = now() where id = ${r['account_id']}`,
      );
      await tx.execute(
        sql`update customer_sessions set revoked_at = now() where account_id = ${r['account_id']} and revoked_at is null`,
      );
      await this.record(
        tx,
        merchantId,
        'online.account_password_reset',
        r['account_id'] as string,
        ip,
        {},
      );
    });
  }

  // ------------------------------------------------------------ orders and addresses
  async orders(customer: StoreCustomer): Promise<AccountOrderList> {
    return this.database.withMerchantTx(customer.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select o.*, (select count(*)::int from online_order_lines l where l.order_id = o.id) as line_count,
                 b.name_en as b_en, b.name_ar as b_ar, b.address as b_address, b.phone as b_phone,
                 da.name_en as da_en, da.name_ar as da_ar
          from online_orders o join branches b on b.id = o.branch_id
          left join online_delivery_areas da on da.id = o.delivery_area_id
          where o.customer_id = ${customer.customerId}
          order by o.created_at desc limit 100`)
      ).rows as Row[];
      return {
        orders: rows.map((o) => ({
          number: o['number'] as string,
          status: o['status'] as 'placed',
          fulfillment: o['fulfillment'] as 'pickup',
          customerName: o['customer_name'] as string,
          subtotal: money(o['subtotal_minor'] as string),
          discount: money(o['discount_minor'] as string),
          promotion: o['promotion_name']
            ? { code: str(o['promotion_code']), name: o['promotion_name'] as string }
            : null,
          deliveryFee: money(o['delivery_fee_minor'] as string),
          total: money(o['total_minor'] as string),
          createdAt: iso(o['created_at'])!,
          paymentMode: o['payment_mode'] as 'gateway',
          paidAt: iso(o['paid_at']),
          reservedUntil: iso(o['reserved_until']),
          trackingToken: o['tracking_token'] as string,
          paymentUrl: null,
          scheduledFor: iso(o['scheduled_for']),
          deliveryAreaName: str(o['delivery_area_name']),
          deliveryArea:
            o['da_en'] || o['da_ar'] ? { nameEn: str(o['da_en']), nameAr: str(o['da_ar']) } : null,
          branch: {
            nameEn: str(o['b_en']),
            nameAr: str(o['b_ar']),
            address: str(o['b_address']),
            phone: str(o['b_phone']),
          },
          lineCount: o['line_count'] as number,
        })),
      };
    });
  }

  private addressView(r: Row): CustomerAddress {
    return {
      id: r['id'] as string,
      label: str(r['label']),
      deliveryAreaId: str(r['delivery_area_id']),
      address: r['address'] as string,
      isDefault: r['is_default'] as boolean,
    };
  }

  private async addressRows(tx: Transaction, customerId: string): Promise<CustomerAddress[]> {
    const rows = (
      await tx.execute(
        sql`select * from customer_addresses where customer_id = ${customerId} order by is_default desc, created_at`,
      )
    ).rows as Row[];
    return rows.map((r) => this.addressView(r));
  }

  /** Inserts or updates an address of the customer, inside the caller's transaction. */
  async saveAddressIn(
    tx: Transaction,
    merchantId: string,
    customerId: string,
    id: string | null,
    input: z.output<typeof saveCustomerAddressSchema>,
  ): Promise<string> {
    if (input.deliveryAreaId) {
      const [a] = (
        await tx.execute(
          sql`select 1 from online_delivery_areas where id = ${input.deliveryAreaId}`,
        )
      ).rows;
      if (!a) throw AppError.notFound('Delivery area not found.');
    }
    if (input.isDefault)
      await tx.execute(
        sql`update customer_addresses set is_default = false, updated_at = now() where customer_id = ${customerId} and is_default`,
      );
    if (id) {
      const [row] = (
        await tx.execute(
          sql`update customer_addresses set label = ${input.label}, delivery_area_id = ${input.deliveryAreaId}, address = ${input.address},
              is_default = ${input.isDefault}, updated_at = now()
              where id = ${id} and customer_id = ${customerId} returning id`,
        )
      ).rows;
      if (!row) throw AppError.notFound('Address not found.');
      return id;
    }
    const newAddressId = newId();
    await tx.execute(sql`
      insert into customer_addresses (id, merchant_id, customer_id, label, delivery_area_id, address, is_default)
      values (${newAddressId}, ${merchantId}, ${customerId}, ${input.label}, ${input.deliveryAreaId}, ${input.address}, ${input.isDefault})`);
    return newAddressId;
  }

  async saveAddress(
    customer: StoreCustomer,
    id: string | null,
    input: z.output<typeof saveCustomerAddressSchema>,
  ): Promise<AccountView> {
    await this.database.withMerchantTx(customer.merchantId, (tx) =>
      this.saveAddressIn(tx, customer.merchantId, customer.customerId, id, input),
    );
    return this.me(customer);
  }

  async deleteAddress(customer: StoreCustomer, id: string): Promise<AccountView> {
    await this.database.withMerchantTx(customer.merchantId, async (tx) => {
      const [row] = (
        await tx.execute(
          sql`delete from customer_addresses where id = ${id} and customer_id = ${customer.customerId} returning id`,
        )
      ).rows;
      if (!row) throw AppError.notFound('Address not found.');
    });
    return this.me(customer);
  }

  private record(
    tx: Transaction,
    merchantId: string,
    action: string,
    accountId: string,
    ip: string,
    details: Row,
  ) {
    return this.audit.recordIn(tx, {
      merchantId,
      actorType: 'anonymous',
      actorId: null,
      action,
      targetType: 'customer_account',
      targetId: accountId,
      ip,
      details,
    });
  }
}

/** Formats a stored quantity the way the public order does. */
export const publicQuantity = (q: string) => formatQuantity(parseQuantity(q));
