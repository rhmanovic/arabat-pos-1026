import {
  type LoginResult,
  type MeResponse,
  type MerchantOption,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  platformLoginRequestSchema,
  platformMfaRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  selectMerchantRequestSchema,
  switchInterfaceRequestSchema,
  switchBranchRequestSchema,
  switchMerchantRequestSchema,
  unlockRequestSchema,
  changePasswordSchema,
  type SessionInfo,
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
import type { z } from 'zod';
import { Authenticated, Public } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor, CurrentPlatformActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor, PlatformActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { type LoginOutcome, LoginService } from './login.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { PlatformAuthService } from './platform-auth.service.js';
import { PosLockService } from './pos-lock.service.js';
import { RegistrationService } from './registration.service.js';
import { AccountService } from './account.service.js';
import { SessionContextService } from './session-context.service.js';
import { SessionService, clientInfo } from './session.service.js';

/** Centralized authentication for all three interfaces (AUTH.md §2). */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly logins: LoginService,
    private readonly platformAuth: PlatformAuthService,
    private readonly resets: PasswordResetService,
    private readonly context: SessionContextService,
    private readonly account: AccountService,
    private readonly sessions: SessionService,
    private readonly posLocks: PosLockService,
  ) {}

  // ------------------------------------------------------------ public
  @Public()
  @Post('register')
  async register(
    @Body(new ZodPipe(registerRequestSchema)) body: z.output<typeof registerRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResult> {
    return this.issue(reply, await this.registration.register(body, clientInfo(request)));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginRequestSchema)) body: z.output<typeof loginRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResult> {
    return this.issue(reply, await this.logins.login(body, clientInfo(request)));
  }

  @Public()
  @Post('login/select')
  @HttpCode(200)
  async select(
    @Body(new ZodPipe(selectMerchantRequestSchema))
    body: z.output<typeof selectMerchantRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResult> {
    return this.issue(reply, await this.logins.select(body, clientInfo(request)));
  }

  @Public()
  @Post('platform/login')
  @HttpCode(200)
  platformLogin(
    @Body(new ZodPipe(platformLoginRequestSchema))
    body: z.output<typeof platformLoginRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<LoginResult> {
    return this.platformAuth.login(body.email, body.password, clientInfo(request));
  }

  @Public()
  @Post('platform/mfa')
  @HttpCode(200)
  async platformMfa(
    @Body(new ZodPipe(platformMfaRequestSchema)) body: z.output<typeof platformMfaRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResult> {
    const { result, token } = await this.platformAuth.verifyMfa(
      body.ticket,
      body.code,
      clientInfo(request),
    );
    this.sessions.setCookie(reply, 'platform', token);
    return result;
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(202)
  async forgot(
    @Body(new ZodPipe(forgotPasswordRequestSchema))
    body: z.output<typeof forgotPasswordRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<{ status: 'accepted' }> {
    await this.resets.requestReset(body.email, body.interface, clientInfo(request));
    return { status: 'accepted' };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(200)
  async reset(
    @Body(new ZodPipe(resetPasswordRequestSchema))
    body: z.output<typeof resetPasswordRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<{ status: 'password_reset' }> {
    await this.resets.resetPassword(body.token, body.password, clientInfo(request));
    return { status: 'password_reset' };
  }

  // ------------------------------------------------------------ manager session
  @Authenticated('manager')
  @Get('manager/me')
  managerMe(@CurrentMerchantActor() actor: MerchantActor): Promise<MeResponse> {
    return this.context.merchantMe(actor);
  }

  @Authenticated('manager')
  @Get('manager/merchants')
  async managerMerchants(
    @CurrentMerchantActor() actor: MerchantActor,
  ): Promise<{ merchants: MerchantOption[] }> {
    return { merchants: await this.context.listMerchants(actor) };
  }

  @Authenticated('manager')
  @Post('manager/switch-merchant')
  @HttpCode(200)
  async managerSwitchMerchant(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(switchMerchantRequestSchema))
    body: z.output<typeof switchMerchantRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResult> {
    return this.issue(
      reply,
      await this.context.switchMerchant(actor, body.merchantId, body.branchId, clientInfo(request)),
    );
  }

  @Authenticated('manager')
  @Post('manager/switch-interface')
  @HttpCode(200)
  async managerSwitchInterface(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(switchInterfaceRequestSchema))
    body: z.output<typeof switchInterfaceRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResult> {
    return this.issue(
      reply,
      await this.context.switchInterface(actor, body.target, body.branchId, clientInfo(request)),
    );
  }

  /** Self-service password change (BR-193): other sessions end, this one is replaced. */
  @Authenticated('manager')
  @Post('manager/password')
  @HttpCode(200)
  async managerChangePassword(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(changePasswordSchema)) body: z.output<typeof changePasswordSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ status: 'password_changed' }> {
    const { token } = await this.account.changePassword(actor, body, clientInfo(request));
    this.sessions.setCookie(reply, 'manager', token);
    return { status: 'password_changed' };
  }

  @Authenticated('manager')
  @Get('manager/sessions')
  async managerSessions(
    @CurrentMerchantActor() actor: MerchantActor,
  ): Promise<{ sessions: SessionInfo[] }> {
    return { sessions: await this.account.list(actor) };
  }

  @Authenticated('manager')
  @Post('manager/sessions/revoke-others')
  @HttpCode(200)
  async managerRevokeOthers(
    @CurrentMerchantActor() actor: MerchantActor,
    @Req() request: FastifyRequest,
  ): Promise<{ ended: number }> {
    return { ended: await this.account.revokeOthers(actor, request.ip) };
  }

  @Authenticated('manager')
  @Delete('manager/sessions/:id')
  @HttpCode(204)
  async managerRevokeSession(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.account.revoke(actor, id, request.ip);
  }

  @Authenticated('manager')
  @Post('manager/logout')
  @HttpCode(204)
  async managerLogout(
    @CurrentMerchantActor() actor: MerchantActor,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.sessions.revoke(actor.sessionId, 'logout');
    this.sessions.clearCookie(reply, 'manager');
  }

  // ------------------------------------------------------------ pos session
  @Authenticated('pos')
  @Get('pos/me')
  posMe(@CurrentMerchantActor() actor: MerchantActor): Promise<MeResponse> {
    return this.context.merchantMe(actor);
  }

  @Authenticated('pos')
  @Get('pos/merchants')
  async posMerchants(
    @CurrentMerchantActor() actor: MerchantActor,
  ): Promise<{ merchants: MerchantOption[] }> {
    return { merchants: await this.context.listMerchants(actor) };
  }

  @Authenticated('pos')
  @Post('pos/switch-merchant')
  @HttpCode(200)
  async posSwitchMerchant(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(switchMerchantRequestSchema))
    body: z.output<typeof switchMerchantRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResult> {
    return this.issue(
      reply,
      await this.context.switchMerchant(actor, body.merchantId, body.branchId, clientInfo(request)),
    );
  }

  @Authenticated('pos')
  @Post('pos/switch-interface')
  @HttpCode(200)
  async posSwitchInterface(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(switchInterfaceRequestSchema))
    body: z.output<typeof switchInterfaceRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResult> {
    return this.issue(
      reply,
      await this.context.switchInterface(actor, body.target, body.branchId, clientInfo(request)),
    );
  }

  @Authenticated('pos')
  @Post('pos/switch-branch')
  @HttpCode(200)
  async posSwitchBranch(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(switchBranchRequestSchema)) body: z.output<typeof switchBranchRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResult> {
    return this.issue(
      reply,
      await this.context.switchBranch(actor, body.branchId, clientInfo(request)),
    );
  }

  /** Locks this till now (cashier steps away, or inactivity detected by the POS). */
  @Authenticated('pos')
  @Post('pos/lock')
  @HttpCode(204)
  async posLock(@CurrentMerchantActor() actor: MerchantActor, @Req() request: FastifyRequest) {
    await this.posLocks.lock(actor.sessionId, actor.merchantId, actor.userId, clientInfo(request));
  }

  /** Public: a locked session cannot authenticate; the cookie and the password prove it. */
  @Public()
  @Post('pos/unlock')
  @HttpCode(204)
  async posUnlock(
    @Body(new ZodPipe(unlockRequestSchema)) body: z.output<typeof unlockRequestSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.posLocks.unlock(request, body.password, clientInfo(request));
  }

  @Public()
  @Post('pos/lock/sign-out')
  @HttpCode(204)
  async posLockedSignOut(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.posLocks.end(request);
    this.sessions.clearCookie(reply, 'pos');
  }

  @Authenticated('pos')
  @Post('pos/logout')
  @HttpCode(204)
  async posLogout(
    @CurrentMerchantActor() actor: MerchantActor,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.sessions.revoke(actor.sessionId, 'logout');
    this.sessions.clearCookie(reply, 'pos');
  }

  // ------------------------------------------------------------ platform session
  @Authenticated('platform')
  @Get('platform/me')
  platformMe(@CurrentPlatformActor() actor: PlatformActor): Promise<MeResponse> {
    return this.context.platformMe(actor);
  }

  @Authenticated('platform')
  @Post('platform/logout')
  @HttpCode(204)
  async platformLogout(
    @CurrentPlatformActor() actor: PlatformActor,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.sessions.revoke(actor.sessionId, 'logout');
    this.sessions.clearCookie(reply, 'platform');
  }

  private issue(reply: FastifyReply, outcome: LoginOutcome): LoginResult {
    if (outcome.session)
      this.sessions.setCookie(reply, outcome.session.interface, outcome.session.token);
    return outcome.result;
  }
}
