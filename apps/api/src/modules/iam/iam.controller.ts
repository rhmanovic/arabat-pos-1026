import {
  type Employee,
  type Invitation,
  type PermissionInfo,
  type Role,
  createRoleSchema,
  employeeStatusSchema,
  inviteEmployeeSchema,
  setAssignmentsSchema,
  updateEmployeeSchema,
  updateRoleSchema,
} from '@arabat/contracts';
import { PERMISSIONS } from '@arabat/permissions';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { EmployeesService } from './employees.service.js';
import { RolesService } from './roles.service.js';

const uuid = new ParseUUIDPipe();

@Controller('manager')
export class IamController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly roles: RolesService,
  ) {}

  // ------------------------------------------------------------ permission catalog & roles
  @RequirePermission('manager', 'employees.read')
  @Get('permissions')
  catalog(): { permissions: PermissionInfo[] } {
    return {
      permissions: Object.entries(PERMISSIONS).map(([key, def]) => ({
        key,
        scope: def.scope,
        group: def.group,
        description: def.description,
      })),
    };
  }

  @RequirePermission('manager', 'employees.read')
  @Get('roles')
  async listRoles(
    @CurrentMerchantActor() actor: MerchantActor,
  ): Promise<{ roles: Role[]; grantable: string[] }> {
    return { roles: await this.roles.list(actor), grantable: this.roles.grantable(actor) };
  }

  @RequirePermission('manager', 'roles.manage')
  @Post('roles')
  createRole(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(createRoleSchema)) body: z.output<typeof createRoleSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Role> {
    return this.roles.create(actor, body, req.ip);
  }

  @RequirePermission('manager', 'roles.manage')
  @Patch('roles/:roleId')
  updateRole(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('roleId', uuid) roleId: string,
    @Body(new ZodPipe(updateRoleSchema)) body: z.output<typeof updateRoleSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Role> {
    return this.roles.update(actor, roleId, body, req.ip);
  }

  @RequirePermission('manager', 'roles.manage')
  @Delete('roles/:roleId')
  @HttpCode(204)
  async deleteRole(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('roleId', uuid) roleId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.roles.remove(actor, roleId, req.ip);
  }

  // ------------------------------------------------------------ employees
  @RequirePermission('manager', 'employees.read')
  @Get('employees')
  list(
    @CurrentMerchantActor() actor: MerchantActor,
  ): Promise<{ employees: Employee[]; invitations: Invitation[] }> {
    return this.employees.list(actor);
  }

  @RequirePermission('manager', 'employees.read')
  @Get('employees/:membershipId')
  get(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('membershipId', uuid) membershipId: string,
  ): Promise<Employee> {
    return this.employees.get(actor, membershipId);
  }

  @RequirePermission('manager', 'employees.manage')
  @Post('employees/invitations')
  invite(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(inviteEmployeeSchema)) body: z.output<typeof inviteEmployeeSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Invitation> {
    return this.employees.invite(actor, body, req.ip);
  }

  @RequirePermission('manager', 'employees.manage')
  @Post('employees/invitations/:invitationId/resend')
  resend(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('invitationId', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<Invitation> {
    return this.employees.resendInvitation(actor, id, req.ip);
  }

  @RequirePermission('manager', 'employees.manage')
  @Post('employees/invitations/:invitationId/revoke')
  @HttpCode(204)
  async revoke(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('invitationId', uuid) id: string,
    @Req() req: FastifyRequest,
  ) {
    await this.employees.revokeInvitation(actor, id, req.ip);
  }

  @RequirePermission('manager', 'employees.manage')
  @Patch('employees/:membershipId')
  update(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('membershipId', uuid) membershipId: string,
    @Body(new ZodPipe(updateEmployeeSchema)) body: z.output<typeof updateEmployeeSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Employee> {
    return this.employees.updateProfile(actor, membershipId, body, req.ip);
  }

  @RequirePermission('manager', 'employees.manage')
  @Post('employees/:membershipId/status')
  setStatus(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('membershipId', uuid) membershipId: string,
    @Body(new ZodPipe(employeeStatusSchema)) body: z.output<typeof employeeStatusSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Employee> {
    return this.employees.setStatus(actor, membershipId, body.status, req.ip);
  }

  @RequirePermission('manager', 'employees.manage')
  @Put('employees/:membershipId/assignments')
  setAssignments(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('membershipId', uuid) membershipId: string,
    @Body(new ZodPipe(setAssignmentsSchema)) body: z.output<typeof setAssignmentsSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Employee> {
    return this.employees.setAssignments(actor, membershipId, body.assignments, req.ip);
  }

  /** Ends every session of the member (stolen cookie, shared till) without deactivating them. */
  @RequirePermission('manager', 'employees.manage')
  @Post('employees/:membershipId/sessions/revoke')
  @HttpCode(200)
  async revokeSessions(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('membershipId', uuid) membershipId: string,
    @Req() req: FastifyRequest,
  ): Promise<{ ended: number }> {
    return { ended: await this.employees.revokeSessions(actor, membershipId, req.ip) };
  }

  /** Clears a sign-in lock caused by wrong passwords (BR-193). */
  @RequirePermission('manager', 'employees.manage')
  @Post('employees/:membershipId/unlock')
  @HttpCode(204)
  async unlock(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('membershipId', uuid) membershipId: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.employees.unlock(actor, membershipId, req.ip);
  }

  @RequirePermission('manager', 'employees.manage')
  @Post('employees/:membershipId/password-reset')
  @HttpCode(202)
  async passwordReset(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('membershipId', uuid) membershipId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.employees.sendPasswordReset(actor, membershipId, req.ip);
    return { status: 'accepted' };
  }
}
