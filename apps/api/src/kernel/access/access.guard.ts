import { can, canAnywhere } from '@arabat/permissions';
import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import { ACCESS_METADATA, type AccessRule } from './access.decorators.js';
import { type Actor, SessionResolver } from './session-resolver.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor?: Actor;
  }
}

/**
 * Global, default-deny access guard (AUTH.md §4). Order: declaration → session → realm/interface
 * → permission/branch. Merchant context, feature and finer branch guards are added in M1.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly logger = new Logger(AccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!rule) {
      // Should be impossible because the auditor blocks boot, but never fail open.
      this.logger.error(
        `Route without access declaration: ${context.getClass().name}.${context.getHandler().name}`,
      );
      throw AppError.forbidden();
    }
    if (rule.kind === 'public') return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const appInterface = rule.kind === 'platform-role' ? 'platform' : rule.interface;
    const actor = await this.sessions.resolve(request, appInterface);
    if (!actor) throw AppError.unauthenticated();
    if (actor.interface !== appInterface) throw AppError.forbidden();
    request.actor = actor;

    switch (rule.kind) {
      case 'authenticated':
        return true;
      case 'platform-role':
        if (actor.realm !== 'platform' || !rule.roles.includes(actor.role))
          throw AppError.forbidden();
        return true;
      case 'permission': {
        if (actor.realm !== 'merchant') throw AppError.forbidden();
        // With a branch in the request (POS binding, :branchId, ?branchId) the permission must
        // hold at that branch. Otherwise this is a coarse gate ("held somewhere"); services
        // then check every affected branch and filter queries (AUTH.md §4).
        const branchId = actor.boundBranchId ?? branchFromRequest(request);
        const allowed = branchId
          ? can(actor.access, rule.permission, branchId)
          : canAnywhere(actor.access, rule.permission);
        if (!allowed) throw AppError.forbidden();
        return true;
      }
    }
  }
}

function branchFromRequest(request: FastifyRequest): string | null {
  const params = request.params as Record<string, unknown> | undefined;
  const query = request.query as Record<string, unknown> | undefined;
  const value = params?.['branchId'] ?? query?.['branchId'];
  return typeof value === 'string' ? value : null;
}
