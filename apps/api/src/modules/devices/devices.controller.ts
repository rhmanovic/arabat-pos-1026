import {
  type PosDevice,
  type RegisterDeviceResult,
  type RegisteredDevice,
  registerDeviceSchema,
} from '@arabat/contracts';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { Public, RequireDevice, RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentDevice, CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { Device } from '../../kernel/access/device-resolver.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { DevicesService } from './devices.service.js';

/** Device registration, called by the device app (ADR-0112, docs/DEVICE_API.md). */
@Controller('device')
export class DeviceRegistrationController {
  constructor(private readonly devices: DevicesService) {}

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
}

/** Managers: the company's devices and their revocation. */
@Controller('manager')
export class ManagerDevicesController {
  constructor(private readonly devices: DevicesService) {}

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
