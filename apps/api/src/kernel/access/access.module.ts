import { Global, Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { AccessGuard } from './access.guard.js';
import { RouteAccessAuditor } from './route-access.auditor.js';
import { NoSessionStoreResolver, SessionResolver } from './session-resolver.js';

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    { provide: SessionResolver, useClass: NoSessionStoreResolver },
    { provide: APP_GUARD, useClass: AccessGuard },
    RouteAccessAuditor,
  ],
  exports: [SessionResolver],
})
export class AccessModule {}
