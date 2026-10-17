import { Module } from '@nestjs/common';
import { DeviceRegistrationController, ManagerDevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';

/** Local-first devices (ADR-0112): registration, revocation, sync. */
@Module({
  controllers: [DeviceRegistrationController, ManagerDevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
