import { Module } from '@nestjs/common';
import { EmployeesService } from './employees.service.js';
import { IamController } from './iam.controller.js';
import { InvitationAcceptanceService } from './invitation-acceptance.service.js';
import { InvitationsController } from './invitations.controller.js';
import { RolesService } from './roles.service.js';

@Module({
  controllers: [IamController, InvitationsController],
  providers: [RolesService, EmployeesService, InvitationAcceptanceService],
  exports: [InvitationAcceptanceService, RolesService],
})
export class IamModule {}
