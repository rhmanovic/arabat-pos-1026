import type { Role, createRoleSchema, updateRoleSchema } from '@arabat/contracts';
import { PERMISSIONS, isPermissionKey, merchantWidePermissions } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { and, count, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { invitationAssignments, roleAssignments, rolePermissions, roles } from './iam.schema.js';

/**
 * Role administration (AUTH.md §3). Anti-escalation: a role may only contain permissions
 * the editor holds merchant-wide, and a role holding more than the editor cannot be edited.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(actor: MerchantActor): Promise<Role[]> {
    return this.database.withMerchantTx(actor.merchantId, (tx) => this.loadAll(tx, actor));
  }

  /** Permission sets of all roles of the merchant (used by employee administration). */
  async permissionsByRole(tx: Transaction): Promise<Map<string, string[]>> {
    const rows = await tx.select().from(rolePermissions);
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(r.roleId, [...(map.get(r.roleId) ?? []), r.permissionKey]);
    return map;
  }

  async create(
    actor: MerchantActor,
    input: z.output<typeof createRoleSchema>,
    ip: string,
  ): Promise<Role> {
    assertCan(actor, 'roles.manage', null);
    const permissions = this.checkGrantable(actor, input.permissions);
    const id = newId();
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await tx
        .insert(roles)
        .values({ id, merchantId: actor.merchantId, nameEn: input.nameEn, nameAr: input.nameAr });
      if (permissions.length) {
        await tx.insert(rolePermissions).values(
          permissions.map((permissionKey) => ({
            merchantId: actor.merchantId,
            roleId: id,
            permissionKey,
          })),
        );
      }
      await this.record(tx, actor, 'role.created', id, ip, { permissions });
      return this.loadOne(tx, actor, id);
    });
  }

  async update(
    actor: MerchantActor,
    roleId: string,
    input: z.output<typeof updateRoleSchema>,
    ip: string,
  ): Promise<Role> {
    assertCan(actor, 'roles.manage', null);
    const permissions = this.checkGrantable(actor, input.permissions);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const current = await this.loadOne(tx, actor, roleId);
      if (!current.editable)
        throw escalation(current.permissions.filter((p) => !this.held(actor).has(p)));
      const [row] = await tx
        .update(roles)
        .set({
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          version: sql`${roles.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(roles.id, roleId), eq(roles.version, input.version)))
        .returning({ id: roles.id });
      if (!row) throw versionConflict();
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      if (permissions.length) {
        await tx.insert(rolePermissions).values(
          permissions.map((permissionKey) => ({
            merchantId: actor.merchantId,
            roleId,
            permissionKey,
          })),
        );
      }
      const added = permissions.filter((p) => !current.permissions.includes(p));
      const removed = current.permissions.filter((p) => !permissions.includes(p));
      await this.record(tx, actor, 'role.updated', roleId, ip, { added, removed });
      return this.loadOne(tx, actor, roleId);
    });
  }

  async remove(actor: MerchantActor, roleId: string, ip: string): Promise<void> {
    assertCan(actor, 'roles.manage', null);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const current = await this.loadOne(tx, actor, roleId);
      if (!current.editable) throw escalation([]);
      const [pending] = await tx
        .select({ n: count() })
        .from(invitationAssignments)
        .where(eq(invitationAssignments.roleId, roleId));
      if (current.assignmentCount > 0 || Number(pending?.n ?? 0) > 0) {
        throw new AppError(
          409,
          'ROLE_IN_USE',
          'This role is assigned to employees or invitations.',
        );
      }
      await tx.delete(roles).where(eq(roles.id, roleId));
      await this.record(tx, actor, 'role.deleted', roleId, ip, {
        name: current.nameEn ?? current.nameAr,
      });
    });
  }

  grantable(actor: MerchantActor): string[] {
    return [...this.held(actor)];
  }

  private held(actor: MerchantActor): Set<string> {
    return new Set(
      actor.access.isOwner ? Object.keys(PERMISSIONS) : merchantWidePermissions(actor.access),
    );
  }

  private checkGrantable(actor: MerchantActor, requested: string[]): string[] {
    const unique = [...new Set(requested)];
    const unknown = unique.filter((p) => !isPermissionKey(p));
    if (unknown.length)
      throw AppError.validation(
        unknown.map((p) => ({
          path: 'permissions',
          code: 'unknown',
          message: `Unknown permission ${p}`,
        })),
      );
    const held = this.held(actor);
    const missing = unique.filter((p) => !held.has(p));
    if (missing.length) throw escalation(missing);
    return unique;
  }

  private async loadAll(tx: Transaction, actor: MerchantActor): Promise<Role[]> {
    const rows = await tx.select().from(roles).orderBy(roles.createdAt);
    const perms = await this.permissionsByRole(tx);
    const counts = await tx
      .select({ roleId: roleAssignments.roleId, n: count() })
      .from(roleAssignments)
      .groupBy(roleAssignments.roleId);
    const countMap = new Map(counts.map((c) => [c.roleId, Number(c.n)]));
    const held = this.held(actor);
    const canManage =
      actor.access.isOwner || merchantWidePermissions(actor.access).includes('roles.manage');
    return rows.map((r) => {
      const permissions = (perms.get(r.id) ?? []).sort();
      return {
        id: r.id,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        templateKey: r.templateKey,
        permissions,
        assignmentCount: countMap.get(r.id) ?? 0,
        version: r.version,
        editable: canManage && permissions.every((p) => held.has(p)),
      };
    });
  }

  private async loadOne(tx: Transaction, actor: MerchantActor, roleId: string): Promise<Role> {
    const role = (await this.loadAll(tx, actor)).find((r) => r.id === roleId);
    if (!role) throw AppError.notFound('Role not found.');
    return role;
  }

  private record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    roleId: string,
    ip: string,
    details = {},
  ) {
    return this.audit.recordIn(tx, {
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action,
      targetType: 'role',
      targetId: roleId,
      ip,
      details,
    });
  }
}

export function escalation(missing: string[]): AppError {
  return new AppError(
    403,
    'PRIVILEGE_ESCALATION',
    missing.length
      ? `You cannot grant permissions you do not hold: ${missing.join(', ')}`
      : 'You cannot change a role or employee with more authority than yours.',
  );
}
