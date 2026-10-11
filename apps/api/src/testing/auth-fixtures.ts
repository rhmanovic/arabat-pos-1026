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
    method: 'GET' | 'POST' | 'PATCH',
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

/** Owner-role helpers that write fixtures directly (setup only; never used by the app). */
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
      async (c) => (await c.query(`select id from branches where is_main`)).rows[0].id,
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
    const roleId = (await c.query(`select id from roles where template_key = $1`, [role])).rows[0]
      ?.id;
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
