import { ROLE_TEMPLATES } from '@arabat/permissions';
import type { Transaction } from '../../database/database.service.js';
import { newId } from '../../kernel/ids.js';
import { branches } from '../branches/branches.schema.js';
import { memberships, rolePermissions, roles } from '../iam/iam.schema.js';
import { ensureDefaultPaymentSetup, ensureDefaultRegister } from '../payments/merchant-defaults.js';
import { merchants } from './merchants.schema.js';

/**
 * Creates a merchant with its main branch, owner membership, default payment methods and
 * register, and the role templates. Shared by self-service registration and platform
 * onboarding; runs in the caller's transaction (merchant RLS context = `merchantId`).
 */
export async function provisionMerchant(
  tx: Transaction,
  input: {
    merchantId: string;
    ownerUserId: string;
    membershipId: string;
    nameEn: string | null;
    nameAr: string | null;
    legalName: string | null;
    contactEmail: string | null;
    contactPhone?: string | null;
    defaultLanguage: 'ar' | 'en';
  },
): Promise<{ branchId: string }> {
  const { merchantId } = input;
  await tx.insert(merchants).values({
    id: merchantId,
    displayNameAr: input.nameAr,
    displayNameEn: input.nameEn,
    legalName: input.legalName,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone ?? null,
    defaultLanguage: input.defaultLanguage,
  });
  const branchId = newId();
  await tx.insert(branches).values({
    id: branchId,
    merchantId,
    code: 'MAIN',
    nameAr: 'الفرع الرئيسي',
    nameEn: 'Main branch',
    isMain: true,
  });
  await tx.insert(memberships).values({
    id: input.membershipId,
    merchantId,
    userId: input.ownerUserId,
    isOwner: true,
    status: 'active',
  });
  await ensureDefaultPaymentSetup(tx, merchantId);
  await ensureDefaultRegister(tx, merchantId, branchId);

  for (const [templateKey, template] of Object.entries(ROLE_TEMPLATES)) {
    const roleId = newId();
    await tx.insert(roles).values({
      id: roleId,
      merchantId,
      templateKey,
      nameEn: template.nameEn,
      nameAr: template.nameAr,
    });
    await tx
      .insert(rolePermissions)
      .values(template.permissions.map((permissionKey) => ({ merchantId, roleId, permissionKey })));
  }
  return { branchId };
}
