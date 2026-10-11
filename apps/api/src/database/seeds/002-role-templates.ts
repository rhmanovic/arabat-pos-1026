import { ROLE_TEMPLATES } from '@arabat/permissions';
import { and, eq } from 'drizzle-orm';
import { newId } from '../../kernel/ids.js';
import { rolePermissions, roles } from '../../modules/iam/iam.schema.js';
import { merchants } from '../../modules/merchants/merchants.schema.js';
import type { Seed } from './seed.types.js';

/**
 * Ensures every merchant has every default role template (new templates are added for
 * existing merchants). Existing roles are never changed: merchants may have customized them.
 * Runs as app_owner (BYPASSRLS) across merchants; idempotent.
 */
export const roleTemplatesSeed: Seed = {
  name: '002-role-templates',
  environments: ['development', 'test', 'production'],
  async run(tx) {
    const all = await tx.select({ id: merchants.id }).from(merchants);
    let created = 0;
    for (const { id: merchantId } of all) {
      for (const [templateKey, template] of Object.entries(ROLE_TEMPLATES)) {
        const [existing] = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(and(eq(roles.merchantId, merchantId), eq(roles.templateKey, templateKey)));
        if (existing) continue;
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
          .values(
            template.permissions.map((permissionKey) => ({ merchantId, roleId, permissionKey })),
          );
        created += 1;
      }
    }
    return `${created} template roles added for ${all.length} merchants`;
  },
};
