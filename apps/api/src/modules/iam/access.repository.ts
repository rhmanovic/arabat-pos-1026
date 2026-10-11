import type { BranchOption, MerchantInterface, MerchantOption } from '@arabat/contracts';
import { type MerchantActorAccess, can } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { branches } from '../branches/branches.schema.js';
import { merchants } from '../merchants/merchants.schema.js';
import { memberships, roleAssignments, rolePermissions } from './iam.schema.js';

export interface MembershipAccess {
  membershipId: string;
  merchantId: string;
  userId: string;
  merchant: { nameEn: string | null; nameAr: string | null; status: string };
  access: MerchantActorAccess;
  /** Active branches of the merchant. */
  branches: BranchOption[];
}

/**
 * Loads what a membership may do, from the database only. Permissions are never derived
 * from a client-side role label (BR-012).
 */
@Injectable()
export class AccessRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Must run inside a transaction whose RLS context is the membership's merchant. */
  async loadMembershipAccess(
    tx: Transaction,
    membershipId: string,
  ): Promise<MembershipAccess | null> {
    const [row] = await tx
      .select({
        membershipId: memberships.id,
        merchantId: memberships.merchantId,
        userId: memberships.userId,
        isOwner: memberships.isOwner,
        membershipStatus: memberships.status,
        merchantStatus: merchants.status,
        nameEn: merchants.displayNameEn,
        nameAr: merchants.displayNameAr,
      })
      .from(memberships)
      .innerJoin(merchants, eq(merchants.id, memberships.merchantId))
      .where(eq(memberships.id, membershipId));
    if (!row) return null;

    const grants = await tx
      .select({ branchId: roleAssignments.branchId, permission: rolePermissions.permissionKey })
      .from(roleAssignments)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roleAssignments.roleId))
      .where(eq(roleAssignments.membershipId, membershipId));

    const activeBranches = await tx
      .select({ id: branches.id, nameEn: branches.nameEn, nameAr: branches.nameAr })
      .from(branches)
      .where(and(eq(branches.merchantId, row.merchantId), eq(branches.status, 'active')))
      .orderBy(desc(branches.isMain), asc(branches.code));
    const activeIds = new Set(activeBranches.map((b) => b.id));

    const byBranch = new Map<string | null, string[]>();
    for (const grant of grants) {
      // Grants at a deactivated branch confer nothing.
      if (grant.branchId !== null && !activeIds.has(grant.branchId)) continue;
      const list = byBranch.get(grant.branchId) ?? [];
      list.push(grant.permission);
      byBranch.set(grant.branchId, list);
    }

    return {
      membershipId: row.membershipId,
      merchantId: row.merchantId,
      userId: row.userId,
      merchant: { nameEn: row.nameEn, nameAr: row.nameAr, status: row.merchantStatus },
      access: {
        isOwner: row.isOwner,
        membershipActive: row.membershipStatus === 'active',
        merchantActive: row.merchantStatus === 'active',
        assignments: [...byBranch].map(([branchId, permissions]) => ({ branchId, permissions })),
      },
      branches: activeBranches,
    };
  }

  /** Every membership of a user, with access loaded per merchant context. */
  async loadUserMemberships(userId: string): Promise<MembershipAccess[]> {
    const rows = await this.database.withContext({ userId }, (tx) =>
      tx
        .select({ id: memberships.id, merchantId: memberships.merchantId })
        .from(memberships)
        .where(eq(memberships.userId, userId)),
    );
    const result: MembershipAccess[] = [];
    for (const row of rows) {
      const access = await this.database.withMerchantTx(row.merchantId, (tx) =>
        this.loadMembershipAccess(tx, row.id),
      );
      if (access) result.push(access);
    }
    return result;
  }
}

/** Branches where the membership may open the given interface. */
export function eligibleBranches(
  m: MembershipAccess,
  appInterface: MerchantInterface,
): BranchOption[] {
  const permission = appInterface === 'manager' ? 'manager.access' : 'pos.access';
  return m.branches.filter((b) => can(m.access, permission, b.id));
}

export function interfacesFor(m: MembershipAccess): MerchantInterface[] {
  return (['manager', 'pos'] as const).filter((i) => eligibleBranches(m, i).length > 0);
}

export function toMerchantOption(
  m: MembershipAccess,
  appInterface: MerchantInterface,
): MerchantOption {
  return {
    id: m.merchantId,
    nameEn: m.merchant.nameEn,
    nameAr: m.merchant.nameAr,
    branches: appInterface === 'pos' ? eligibleBranches(m, 'pos') : [],
  };
}
