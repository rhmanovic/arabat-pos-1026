import { Global, Module } from '@nestjs/common';
import { SessionResolver } from '../../kernel/access/session-resolver.js';
import { AccessRepository } from '../iam/access.repository.js';
import { AuthController } from './auth.controller.js';
import { DbSessionResolver } from './db-session.resolver.js';
import { LoginService } from './login.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { PasswordService } from './password.service.js';
import { PlatformAuthService } from './platform-auth.service.js';
import { RateLimiterService } from './rate-limiter.service.js';
import { RegistrationService } from './registration.service.js';
import { SessionContextService } from './session-context.service.js';
import { SessionService } from './session.service.js';
import { TicketService } from './ticket.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AccessRepository,
    PasswordService,
    RateLimiterService,
    SessionService,
    TicketService,
    LoginService,
    RegistrationService,
    PasswordResetService,
    PlatformAuthService,
    SessionContextService,
    { provide: SessionResolver, useClass: DbSessionResolver },
  ],
  exports: [
    SessionResolver,
    AccessRepository,
    PasswordService,
    PasswordResetService,
    RateLimiterService,
    SessionService,
  ],
})
export class AuthModule {}
