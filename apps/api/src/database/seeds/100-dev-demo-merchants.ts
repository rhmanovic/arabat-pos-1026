import { ROLE_TEMPLATES, type RoleTemplateKey } from '@arabat/permissions';
import { hash } from '@node-rs/argon2';
import { and, eq, sql } from 'drizzle-orm';
import { newId } from '../../kernel/ids.js';
import { upsertOperator } from '../../modules/platform-admin/operators.js';
import { branches } from '../../modules/branches/branches.schema.js';
import {
  memberships,
  roleAssignments,
  rolePermissions,
  roles,
  users,
} from '../../modules/iam/iam.schema.js';
import { merchants } from '../../modules/merchants/merchants.schema.js';
import type { Transaction } from '../database.service.js';
import {
  DEV_ACCOUNTS,
  DEV_MERCHANTS,
  DEV_OPERATOR_TOTP_SECRET,
  DEV_PASSWORD,
} from './dev-accounts.js';
import type { Seed } from './seed.types.js';

type Grant = { role: RoleTemplateKey; branch: 'main' | 'all' };

const MERCHANTS = [
  {
    id: DEV_MERCHANTS.demo,
    nameAr: 'متجر تجريبي',
    nameEn: 'Demo Store',
    branches: [
      { code: 'MAIN', nameAr: 'الفرع الرئيسي', nameEn: 'Main branch', isMain: true },
      { code: 'SALMIYA', nameAr: 'فرع السالمية', nameEn: 'Salmiya branch', isMain: false },
    ],
    members: [
      { email: DEV_ACCOUNTS.owner, owner: true, grants: [] as Grant[] },
      {
        email: DEV_ACCOUNTS.manager,
        owner: false,
        grants: [{ role: 'company_manager', branch: 'all' }] as Grant[],
      },
      {
        email: DEV_ACCOUNTS.cashier,
        owner: false,
        grants: [{ role: 'cashier', branch: 'main' }] as Grant[],
      },
      {
        email: DEV_ACCOUNTS.multi,
        owner: false,
        grants: [{ role: 'company_manager', branch: 'all' }] as Grant[],
      },
    ],
  },
  {
    id: DEV_MERCHANTS.second,
    nameAr: 'المحل الثاني',
    nameEn: 'Second Shop',
    branches: [{ code: 'MAIN', nameAr: 'الفرع الرئيسي', nameEn: 'Main branch', isMain: true }],
    members: [
      { email: DEV_ACCOUNTS.multi, owner: true, grants: [] as Grant[] },
      {
        email: DEV_ACCOUNTS.cashier,
        owner: false,
        grants: [{ role: 'cashier', branch: 'main' }] as Grant[],
      },
    ],
  },
];

const NAMES: Record<string, string> = {
  [DEV_ACCOUNTS.owner]: 'مالك تجريبي',
  [DEV_ACCOUNTS.manager]: 'مدير تجريبي',
  [DEV_ACCOUNTS.cashier]: 'كاشير تجريبي',
  [DEV_ACCOUNTS.multi]: 'مستخدم متعدد الشركات',
};

async function setContext(tx: Transaction, merchantId: string) {
  await tx.execute(sql`select set_config('app.merchant_id', ${merchantId}, true)`);
}

/** Demo merchants, users and a platform operator for local development (idempotent). */
export const devDemoMerchantsSeed: Seed = {
  name: '100-dev-demo-merchants',
  environments: ['development'],
  async run(tx) {
    const passwordHash = await hash(DEV_PASSWORD, {
      algorithm: 2,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const userIds = new Map<string, string>();
    for (const email of Object.values(DEV_ACCOUNTS).filter((e) => e !== DEV_ACCOUNTS.operator)) {
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email));
      const id = existing?.id ?? newId();
      if (existing) {
        await tx.update(users).set({ passwordHash, status: 'active' }).where(eq(users.id, id));
      } else {
        await tx.insert(users).values({
          id,
          email,
          passwordHash,
          fullName: NAMES[email] ?? email,
          preferredLanguage: 'ar',
        });
      }
      userIds.set(email, id);
    }

    for (const m of MERCHANTS) {
      await setContext(tx, m.id);
      await tx
        .insert(merchants)
        .values({ id: m.id, displayNameAr: m.nameAr, displayNameEn: m.nameEn, status: 'active' })
        .onConflictDoUpdate({ target: merchants.id, set: { status: 'active' } });

      const branchIds: Record<string, string> = {};
      for (const b of m.branches) {
        const [existing] = await tx
          .select({ id: branches.id })
          .from(branches)
          .where(and(eq(branches.merchantId, m.id), eq(branches.code, b.code)));
        const id = existing?.id ?? newId();
        if (!existing) await tx.insert(branches).values({ id, merchantId: m.id, ...b });
        if (b.isMain) branchIds['main'] = id;
      }

      const roleIds: Partial<Record<RoleTemplateKey, string>> = {};
      for (const [key, template] of Object.entries(ROLE_TEMPLATES) as [
        RoleTemplateKey,
        (typeof ROLE_TEMPLATES)[RoleTemplateKey],
      ][]) {
        const [existing] = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(and(eq(roles.merchantId, m.id), eq(roles.templateKey, key)));
        const id = existing?.id ?? newId();
        if (!existing)
          await tx.insert(roles).values({
            id,
            merchantId: m.id,
            templateKey: key,
            nameAr: template.nameAr,
            nameEn: template.nameEn,
          });
        await tx
          .insert(rolePermissions)
          .values(
            template.permissions.map((permissionKey) => ({
              merchantId: m.id,
              roleId: id,
              permissionKey,
            })),
          )
          .onConflictDoNothing();
        roleIds[key] = id;
      }

      for (const member of m.members) {
        const userId = userIds.get(member.email)!;
        const [existing] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.merchantId, m.id), eq(memberships.userId, userId)));
        const membershipId = existing?.id ?? newId();
        if (!existing) {
          await tx.insert(memberships).values({
            id: membershipId,
            merchantId: m.id,
            userId,
            isOwner: member.owner,
            status: 'active',
          });
        }
        for (const grant of member.grants) {
          await tx
            .insert(roleAssignments)
            .values({
              id: newId(),
              merchantId: m.id,
              membershipId,
              roleId: roleIds[grant.role]!,
              branchId: grant.branch === 'all' ? null : branchIds['main']!,
            })
            .onConflictDoNothing();
        }
      }
    }

    const key = process.env['MFA_ENCRYPTION_KEY'];
    if (!key)
      throw new Error('MFA_ENCRYPTION_KEY is required to seed the development platform operator');
    await upsertOperator(tx, {
      email: DEV_ACCOUNTS.operator,
      fullName: 'Platform Operator (dev)',
      role: 'platform.super_admin',
      passwordHash,
      encryptionKey: key,
      totpSecret: DEV_OPERATOR_TOTP_SECRET,
    });
    return `2 demo merchants, ${userIds.size} users, 1 operator (password ${DEV_PASSWORD})`;
  },
};
