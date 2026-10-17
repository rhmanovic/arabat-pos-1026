import { Global, Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { AccessGuard } from './access.guard.js';
import { DeviceResolver } from './device-resolver.js';
import { PrintAgentResolver } from './print-agent-resolver.js';
import { RouteAccessAuditor } from './route-access.auditor.js';

/**
 * Global default-deny guard and boot-time route auditor. The SessionResolver it depends on
 * is provided by the auth module (database-backed sessions).
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    { provide: APP_GUARD, useClass: AccessGuard },
    RouteAccessAuditor,
    PrintAgentResolver,
    DeviceResolver,
  ],
  exports: [PrintAgentResolver, DeviceResolver],
})
export class AccessModule {}
