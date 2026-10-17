import {
  type DeviceSettings,
  type DeviceSnapshot,
  type PosDevice,
  type RegisterDeviceResult,
  type RegisteredDevice,
  deviceSettingsSchema,
  deviceSyncQuerySchema,
  registerDeviceSchema,
} from '@arabat/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { Public, RequireDevice, RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentDevice, CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { Device } from '../../kernel/access/device-resolver.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { DeviceSyncService } from './device-sync.service.js';
import { DevicesService } from './devices.service.js';

/** Device registration, called by the device app (ADR-0112, docs/DEVICE_API.md). */
@Controller('device')
export class DeviceRegistrationController {
  constructor(
    private readonly devices: DevicesService,
    private readonly sync: DeviceSyncService,
  ) {}

  /** Public: the manager's e-mail and password are the credential; rate-limited like a login. */
  @Public()
  @Post('register')
  @HttpCode(200)
  register(
    @Body(new ZodPipe(registerDeviceSchema)) body: z.output<typeof registerDeviceSchema>,
    @Req() req: FastifyRequest,
  ): Promise<RegisterDeviceResult> {
    return this.devices.register(body, req.ip);
  }

  /** The device as the server knows it: checks the token (401, or 401 `DEVICE_REVOKED`). */
  @RequireDevice()
  @Get('me')
  me(@CurrentDevice() device: Device): Promise<RegisteredDevice> {
    return this.devices.describe(device);
  }

  /** Sync download (ADR-0112 §7a): the full snapshot, or product changes since `since`. */
  @RequireDevice()
  @Get('sync')
  download(
    @CurrentDevice() device: Device,
    @Query(new ZodPipe(deviceSyncQuerySchema)) query: z.output<typeof deviceSyncQuerySchema>,
  ): Promise<DeviceSnapshot> {
    return this.sync.download(device, query.since);
  }
}

/** Managers: the company's devices and their revocation. */
@Controller('manager')
export class ManagerDevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly sync: DeviceSyncService,
  ) {}

  @RequirePermission('manager', 'merchant.settings.read')
  @Get('device-settings')
  settings(@CurrentMerchantActor() actor: MerchantActor): Promise<DeviceSettings> {
    return this.sync.getSettings(actor);
  }

  @RequirePermission('manager', 'merchant.settings.update')
  @Put('device-settings')
  updateSettings(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(deviceSettingsSchema)) body: z.output<typeof deviceSettingsSchema>,
    @Req() req: FastifyRequest,
  ): Promise<DeviceSettings> {
    return this.sync.updateSettings(actor, body, req.ip);
  }

  @RequirePermission('manager', 'registers.manage')
  @Get('devices')
  async list(@CurrentMerchantActor() actor: MerchantActor): Promise<{ devices: PosDevice[] }> {
    return { devices: await this.devices.list(actor) };
  }

  @RequirePermission('manager', 'registers.manage')
  @Post('devices/:id/revoke')
  @HttpCode(204)
  async revoke(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.devices.revoke(actor, id, req.ip);
  }
}
