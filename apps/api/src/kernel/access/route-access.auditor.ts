import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { ACCESS_METADATA } from './access.decorators.js';

/** Nest stores the route path of a handler under this metadata key (`@Get()`, `@Post()`, ...). */
const ROUTE_PATH_METADATA = 'path';

export class MissingAccessDeclarationError extends Error {
  constructor(routes: string[]) {
    super(
      `Routes without an access declaration (@Public, @Authenticated, @RequirePermission, ` +
        `@RequirePlatformRole):\n  ${routes.join('\n  ')}`,
    );
    this.name = 'MissingAccessDeclarationError';
  }
}

/** Refuses to boot the application if any route lacks an access declaration (fail closed). */
@Injectable()
export class RouteAccessAuditor implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const missing = this.findUndeclaredRoutes();
    if (missing.length > 0) throw new MissingAccessDeclarationError(missing);
  }

  findUndeclaredRoutes(): string[] {
    const missing: string[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        const handler = prototype[methodName];
        if (typeof handler !== 'function') continue;
        if (Reflect.getMetadata(ROUTE_PATH_METADATA, handler) === undefined) continue;
        const rule = this.reflector.getAllAndOverride(ACCESS_METADATA, [handler, metatype]);
        if (!rule) missing.push(`${metatype.name}.${methodName}`);
      }
    }
    return missing;
  }
}
