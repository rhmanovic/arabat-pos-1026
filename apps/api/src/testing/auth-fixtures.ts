import { ROLE_TEMPLATES, type RoleTemplateKey } from '@arabat/permissions';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { newId } from '../kernel/ids.js';

export type Interface = 'manager' | 'pos' | 'platform';
const COOKIE: Record<Interface, string> = {
  manager: 'mgr_sid',
  pos: 'pos_sid',
  platform: 'plat_sid',
};

let ipCounter = 0;
/** A distinct client IP per call site so rate-limit buckets of tests do not interfere. */
export function freshIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}@test.arabat`;
}

export const PASSWORD = 'Correct-Horse-42';

export class ApiClient {
  ip = freshIp();
  constructor(private readonly app: NestFastifyApplication) {}

  async request(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    opts: {
      body?: unknown;
      cookies?: Record<string, string>;
      headers?: Record<string, string>;
    } = {},
  ) {
    return this.app.inject({
      method,
      url: `/api/v1${url}`,
      remoteAddress: this.ip,
      ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
      ...(opts.cookies ? { cookies: opts.cookies } : {}),
      ...(opts.headers ? { headers: opts.headers } : {}),
    });
  }
}

type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

/** Extracts the session cookie of an interface from a response. */
export function sessionCookie(res: InjectResponse, iface: Interface): Record<string, string> {
  const cookie = res.cookies.find((c) => c.name === COOKIE[iface]);
  if (!cookie)
    throw new Error(`No ${COOKIE[iface]} cookie in response (${res.statusCode}): ${res.body}`);
  return { [COOKIE[iface]]: cookie.value };
}

export async function registerOwner(
  api: ApiClient,
  overrides: { email?: string; nameAr?: string } = {},
) {
  const email = overrides.email ?? uniqueEmail('owner');
  const res = await api.request('POST', '/auth/register', {
    body: {
      company: { nameAr: overrides.nameAr ?? 'شركة اختبار', nameEn: 'Test Co' },
      owner: { fullName: 'Owner Test', email, password: PASSWORD },
    },
  });
  if (res.statusCode !== 201) throw new Error(`register failed ${res.statusCode}: ${res.body}`);
  const cookies = sessionCookie(res, 'manager');
  const me = (await api.request('GET', '/auth/manager/me', { cookies })).json();
  return { email, cookies, merchantId: me.merchant.id as string, userId: me.actor.id as string };
}

/**
 * Owner-role helpers that write fixtures directly (setup only; never used by the app).
 * app_owner has BYPASSRLS, so every query here filters by merchant explicitly.
 */
export class DbFixtures {
  constructor(private readonly owner: pg.Pool) {}

  async inMerchant<T>(merchantId: string, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.owner.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.merchant_id', $1, true)`, [merchantId]);
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async mainBranch(merchantId: string): Promise<string> {
    return this.inMerchant(
      merchantId,
      async (c) =>
        (await c.query(`select id from branches where is_main and merchant_id = $1`, [merchantId]))
          .rows[0].id,
    );
  }

  async addBranch(merchantId: string, code: string): Promise<string> {
    const id = newId();
    await this.inMerchant(merchantId, (c) =>
      c.query(`insert into branches (id, merchant_id, code, name_en) values ($1, $2, $3, $3)`, [
        id,
        merchantId,
        code,
      ]),
    );
    return id;
  }

  /** Creates (or reuses) a user and gives them a membership with a template role. */
  async addEmployee(
    merchantId: string,
    opts: {
      email?: string;
      userId?: string;
      role: RoleTemplateKey;
      branchId?: string | null;
      passwordHash: string;
    },
  ): Promise<{ userId: string; membershipId: string; email: string }> {
    const email = opts.email ?? uniqueEmail(opts.role);
    let userId = opts.userId;
    if (!userId) {
      userId = newId();
      await this.owner.query(
        `insert into users (id, email, password_hash, full_name) values ($1, $2, $3, $4)`,
        [userId, email, opts.passwordHash, `${opts.role} user`],
      );
    }
    const membershipId = newId();
    await this.inMerchant(merchantId, async (c) => {
      await c.query(
        `insert into memberships (id, merchant_id, user_id, status) values ($1, $2, $3, 'active')`,
        [membershipId, merchantId, userId],
      );
      await this.grant(c, merchantId, membershipId, opts.role, opts.branchId ?? null);
    });
    return { userId, membershipId, email };
  }

  async grantRole(
    merchantId: string,
    membershipId: string,
    role: RoleTemplateKey,
    branchId: string | null,
  ) {
    await this.inMerchant(merchantId, (c) =>
      this.grant(c, merchantId, membershipId, role, branchId),
    );
  }

  private async grant(
    c: pg.PoolClient,
    merchantId: string,
    membershipId: string,
    role: RoleTemplateKey,
    branchId: string | null,
  ) {
    const roleId = (
      await c.query(`select id from roles where template_key = $1 and merchant_id = $2`, [
        role,
        merchantId,
      ])
    ).rows[0]?.id;
    if (!roleId)
      throw new Error(
        `Role template ${role} missing; expected ${Object.keys(ROLE_TEMPLATES).join(', ')}`,
      );
    await c.query(
      `insert into role_assignments (id, merchant_id, membership_id, role_id, branch_id) values ($1, $2, $3, $4, $5)`,
      [newId(), merchantId, membershipId, roleId, branchId],
    );
  }
}

type Cookies = Record<string, string>;

/** Owner + main branch + a second branch + template role ids (shared by module tests). */
export async function createCompany(
  app: NestFastifyApplication,
  db: DbFixtures,
  mailer: { outbox: { to: string; text: string }[] },
) {
  const client = new ApiClient(app);
  const o = await registerOwner(client);
  const main = await db.mainBranch(o.merchantId);
  const second = (
    await client.request('POST', '/manager/branches', {
      cookies: o.cookies,
      body: { code: 'B2', nameEn: 'Second', nameAr: 'الثاني' },
    })
  ).json().id as string;
  const list = (await client.request('GET', '/manager/roles', { cookies: o.cookies })).json()
    .roles as { id: string; templateKey: string }[];
  const role = (key: string) => list.find((r) => r.templateKey === key)!.id;
  const roles = {
    company_manager: role('company_manager'),
    branch_manager: role('branch_manager'),
    supervisor: role('supervisor'),
    cashier: role('cashier'),
  };

  /** Invites + accepts; returns a signed-in session cookie for the interface. */
  async function hire(
    assignments: { roleId: string; branchId: string | null }[],
    iface: 'manager' | 'pos',
    by: Cookies = o.cookies,
  ) {
    const email = uniqueEmail('emp');
    const res = await client.request('POST', '/manager/employees/invitations', {
      cookies: by,
      body: { email, fullName: 'Employee', assignments },
    });
    if (res.statusCode !== 201) throw new Error(`invite failed ${res.statusCode} ${res.body}`);
    const mail = [...mailer.outbox].reverse().find((m) => m.to === email)!;
    const token = /token=([\w-]+)/.exec(mail.text)![1]!;
    await client.request('POST', '/auth/invitations/accept', {
      body: { token, password: PASSWORD },
    });
    const login = await client.request('POST', '/auth/login', {
      body: { interface: iface, email, password: PASSWORD },
    });
    let result = login.json();
    let final = login;
    if (result.status === 'select_merchant') {
      final = await client.request('POST', '/auth/login/select', {
        body: {
          ticket: result.ticket,
          merchantId: o.merchantId,
          branchId: result.merchants[0].branches[0]?.id,
        },
      });
      result = final.json();
    }
    if (result.status !== 'authenticated') throw new Error(`login failed ${final.body}`);
    return { email, cookies: sessionCookie(final, iface) };
  }

  /** The owner's POS session at a branch. */
  async function ownerPos(branchId: string) {
    const res = await client.request('POST', '/auth/manager/switch-interface', {
      cookies: o.cookies,
      body: { target: 'pos', branchId },
    });
    return sessionCookie(res, 'pos');
  }

  /**
   * Records a physical count of a branch treasury (ADR-0090): a treasury pays nothing out
   * before its opening count. Returns the treasury account id.
   */
  async function countTreasury(branchId: string, countedCash: string, note = 'test count') {
    const overview = (
      await client.request('GET', `/manager/cash/overview?branchId=${branchId}`, {
        cookies: o.cookies,
      })
    ).json();
    const treasury = overview.branches[0].treasury;
    const res = await client.request(
      'POST',
      `/manager/cash/accounts/${treasury.accountId}/counts`,
      {
        cookies: o.cookies,
        body: { countedCash, expectedCash: treasury.balance.amount, note },
      },
    );
    if (res.statusCode !== 201) throw new Error(`count failed ${res.statusCode} ${res.body}`);
    return treasury.accountId as string;
  }

  /**
   * Switches the blind-count policy off (BR-162) so tests about drawer figures can read them
   * through a cashier's own session.
   */
  async function showExpectedCash() {
    const current = (
      await client.request('GET', '/manager/sales-settings', { cookies: o.cookies })
    ).json();
    const res = await client.request('PUT', '/manager/sales-settings', {
      cookies: o.cookies,
      body: {
        maxDiscountPercent: current.maxDiscountPercent,
        refundWindowDays: current.refundWindowDays,
        refundApprovalLimit: current.refundApprovalLimit.amount,
        blindCashCount: false,
        cashOutOtherLimit: current.cashOutOtherLimit.amount,
        cashOutOtherShiftLimit: current.cashOutOtherShiftLimit.amount,
        maxRegisterTolerance: current.maxRegisterTolerance.amount,
        expenseApprovalLimit: current.expenseApprovalLimit.amount,
        supplierPaymentApprovalLimit: current.supplierPaymentApprovalLimit.amount,
        version: current.version,
      },
    });
    if (res.statusCode !== 200) throw new Error(`settings failed ${res.statusCode} ${res.body}`);
  }

  return { client, ...o, main, second, roles, hire, ownerPos, countTreasury, showExpectedCash };
}
