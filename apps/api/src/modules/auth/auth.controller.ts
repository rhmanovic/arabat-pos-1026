import type { MeResponse } from '@arabat/contracts';
import { PERMISSIONS } from '@arabat/permissions';
import { Controller, Get, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../kernel/access/access.decorators.js';
import type { Actor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';

/**
 * Centralized session endpoints for the three interfaces (AUTH.md §2). Login, logout and the
 * session store arrive in milestone M1; until then no session exists and `me` answers 401.
 */
@Controller('auth')
export class AuthController {
  @Authenticated('manager')
  @Get('manager/me')
  managerMe(@Req() request: FastifyRequest): MeResponse {
    return toMe(request.actor);
  }

  @Authenticated('pos')
  @Get('pos/me')
  posMe(@Req() request: FastifyRequest): MeResponse {
    return toMe(request.actor);
  }

  @Authenticated('platform')
  @Get('platform/me')
  platformMe(@Req() request: FastifyRequest): MeResponse {
    return toMe(request.actor);
  }
}

function toMe(actor: Actor | undefined): MeResponse {
  // The AccessGuard only lets authenticated requests through; this is a defensive check.
  if (!actor) throw AppError.unauthenticated();
  return actor.realm === 'merchant'
    ? {
        interface: actor.interface,
        realm: 'merchant',
        actorId: actor.userId,
        merchantId: actor.merchantId,
        boundBranchId: actor.boundBranchId,
        permissions: actor.access.isOwner
          ? Object.keys(PERMISSIONS)
          : [...new Set(actor.access.assignments.flatMap((a) => a.permissions))],
      }
    : {
        interface: 'platform',
        realm: 'platform',
        actorId: actor.operatorId,
        merchantId: null,
        boundBranchId: null,
        permissions: [actor.role],
      };
}
