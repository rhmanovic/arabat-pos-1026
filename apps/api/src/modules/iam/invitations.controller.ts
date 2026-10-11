import {
  type InvitationPreview,
  acceptInvitationSchema,
  invitationTokenSchema,
} from '@arabat/contracts';
import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { Public } from '../../kernel/access/access.decorators.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { clientInfo } from '../auth/session.service.js';
import { InvitationAcceptanceService } from './invitation-acceptance.service.js';

/** Public invitation endpoints; the single-use token is the credential. */
@Controller('auth/invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationAcceptanceService) {}

  @Public()
  @Post('preview')
  @HttpCode(200)
  preview(
    @Body(new ZodPipe(invitationTokenSchema)) body: z.output<typeof invitationTokenSchema>,
    @Req() req: FastifyRequest,
  ): Promise<InvitationPreview> {
    return this.invitations.preview(body.token, clientInfo(req));
  }

  @Public()
  @Post('accept')
  @HttpCode(200)
  accept(
    @Body(new ZodPipe(acceptInvitationSchema)) body: z.output<typeof acceptInvitationSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.invitations.accept(
      body.token,
      body.password,
      body.preferredLanguage,
      clientInfo(req),
    );
  }
}
