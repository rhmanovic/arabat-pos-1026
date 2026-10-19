import {
  type CreatedPinLink,
  type LoginResult,
  PIN_LINK_KEY,
  type PinLinkList,
  type PinSignInBranch,
  pinSignInRequestSchema,
} from '@arabat/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public, RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { PinSignInService } from './pin-sign-in.service.js';
import { SessionService, clientInfo } from './session.service.js';

const keySchema = z.object({ key: z.string().regex(PIN_LINK_KEY) });

/**
 * Browser POS sign-in with name + PIN (Plan A). The link key travels in the body, never in a URL
 * the server logs (the page keeps it in the address's `#` part).
 */
@Controller('auth/pos/pin-sign-in')
export class PinSignInController {
  constructor(
    private readonly pins: PinSignInService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('branch')
  @HttpCode(200)
  branch(
    @Body(new ZodPipe(keySchema)) body: z.output<typeof keySchema>,
    @Req() req: FastifyRequest,
  ): Promise<PinSignInBranch> {
    return this.pins.branch(body.key, req.ip);
  }

  @Public()
  @Post()
  @HttpCode(200)
  async signIn(
    @Body(new ZodPipe(pinSignInRequestSchema)) body: z.output<typeof pinSignInRequestSchema>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResult> {
    const outcome = await this.pins.signIn(body, clientInfo(req));
    if (outcome.session)
      this.sessions.setCookie(reply, outcome.session.interface, outcome.session.token);
    return outcome.result;
  }
}

/** Managers: the PIN sign-in link of each branch. */
@Controller('manager/pin-links')
export class PinLinksController {
  constructor(private readonly pins: PinSignInService) {}

  @RequirePermission('manager', 'registers.manage')
  @Get()
  list(@CurrentMerchantActor() actor: MerchantActor): Promise<PinLinkList> {
    return this.pins.links(actor);
  }

  /** A new link; the previous one of the branch stops working. The key is shown only here. */
  @RequirePermission('manager', 'registers.manage')
  @Post(':branchId')
  @HttpCode(201)
  create(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Req() req: FastifyRequest,
  ): Promise<CreatedPinLink> {
    return this.pins.createLink(actor, branchId, req.ip);
  }

  @RequirePermission('manager', 'registers.manage')
  @Delete(':branchId')
  @HttpCode(204)
  async remove(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.pins.removeLink(actor, branchId, req.ip);
  }
}
