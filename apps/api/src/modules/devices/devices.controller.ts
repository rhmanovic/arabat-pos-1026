import {
  type DeviceException,
  type DeviceSettings,
  type DeviceSnapshot,
  type DeviceUploadResult,
  type PosDevice,
  type RegisterDeviceResult,
  type RegisteredDevice,
  deviceExceptionQuerySchema,
  devicePinResetCompleteSchema,
  devicePinResetRequestSchema,
  deviceSettingsSchema,
  deviceSyncQuerySchema,
  deviceUploadSchema,
  registerDeviceSchema,
  resolveDeviceExceptionSchema,
  updatePosDeviceSchema,
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
import { DeviceExceptionsService } from './device-exceptions.service.js';
import { DeviceIngestService } from './device-ingest.service.js';
import { DeviceSyncService } from './device-sync.service.js';
import { PinResetService } from './pin-reset.service.js';
import { DevicesService } from './devices.service.js';

/** Device registration, called by the device app (ADR-0112, docs/DEVICE_API.md). */
@Controller('device')
export class DeviceRegistrationController {
  constructor(
    private readonly devices: DevicesService,
    private readonly sync: DeviceSyncService,
    private readonly ingest: DeviceIngestService,
    private readonly pins: PinResetService,
  ) {}

  /**
   * A cashier at the till asks for a link to choose their own PIN (ADR-0112, owner decision 6).
   * Always 202; the link goes to the member's e-mail. 429 when asked again within 5 minutes.
   */
  @RequireDevice()
  @Post('pin-reset')
  @HttpCode(202)
  async requestPinReset(
    @CurrentDevice() device: Device,
    @Body(new ZodPipe(devicePinResetRequestSchema))
    body: z.output<typeof devicePinResetRequestSchema>,
    @Req() req: FastifyRequest,
  ): Promise<{ status: 'accepted' }> {
    await this.pins.request(device, body.membershipId, req.ip);
    return { status: 'accepted' };
  }

  /** The page behind the e-mailed link sets the PIN (public; the token is the credential). */
  @Public()
  @Post('pin-reset/complete')
  @HttpCode(200)
  async completePinReset(
    @Body(new ZodPipe(devicePinResetCompleteSchema))
    body: z.output<typeof devicePinResetCompleteSchema>,
    @Req() req: FastifyRequest,
  ): Promise<{ status: 'pin_set' }> {
    await this.pins.complete(body.token, body.pin, req.ip);
    return { status: 'pin_set' };
  }

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

  /**
   * Sync upload (ADR-0112 §7b): completed records in causal order, answered per record
   * (`accepted`, `duplicate` or `refused`). 200 even when some records are refused.
   */
  @RequireDevice()
  @Post('sync')
  @HttpCode(200)
  upload(
    @CurrentDevice() device: Device,
    @Body(new ZodPipe(deviceUploadSchema)) body: z.output<typeof deviceUploadSchema>,
    @Req() req: FastifyRequest,
  ): Promise<DeviceUploadResult> {
    return this.ingest.upload(device, body.records, req.ip);
  }
}

/** Managers: the company's devices and their revocation. */
@Controller('manager')
export class ManagerDevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly sync: DeviceSyncService,
    private readonly exceptions: DeviceExceptionsService,
  ) {}

  /** Negative stock, wrong clocks and refused records from device uploads (ADR-0112). */
  @RequirePermission('manager', 'registers.manage')
  @Get('device-exceptions')
  async listExceptions(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(deviceExceptionQuerySchema))
    query: z.output<typeof deviceExceptionQuerySchema>,
  ): Promise<{ exceptions: DeviceException[] }> {
    return { exceptions: await this.exceptions.list(actor, query.status) };
  }

  @RequirePermission('manager', 'registers.manage')
  @Post('device-exceptions/:id/resolve')
  @HttpCode(204)
  async resolveException(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(resolveDeviceExceptionSchema))
    body: z.output<typeof resolveDeviceExceptionSchema>,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.exceptions.resolve(actor, id, body.note, req.ip);
  }

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

  /** Owner only (checked in the service): role and branch; nothing is revoked (Plan A). */
  @RequirePermission('manager', 'registers.manage')
  @Put('devices/:id')
  update(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(updatePosDeviceSchema)) body: z.output<typeof updatePosDeviceSchema>,
    @Req() req: FastifyRequest,
  ): Promise<PosDevice> {
    return this.devices.update(actor, id, body, req.ip);
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
