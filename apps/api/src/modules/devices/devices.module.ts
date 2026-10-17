import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PrintingModule } from '../printing/printing.module.js';
import { RefundsModule } from '../refunds/refunds.module.js';
import { DeviceRegistrationController, ManagerDevicesController } from './devices.controller.js';
import { DeviceIngestService } from './device-ingest.service.js';
import { DeviceSyncService } from './device-sync.service.js';
import { DevicesService } from './devices.service.js';

/** Local-first devices (ADR-0112): registration, revocation, sync. */
@Module({
  imports: [InventoryModule, PrintingModule, RefundsModule],
  controllers: [DeviceRegistrationController, ManagerDevicesController],
  providers: [DevicesService, DeviceSyncService, DeviceIngestService],
  exports: [DevicesService],
})
export class DevicesModule {}
