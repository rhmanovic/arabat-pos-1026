import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import type { MerchantActor, PlatformActor } from './session-resolver.js';

/** The merchant actor set by the AccessGuard. Only valid on merchant-protected routes. */
export const CurrentMerchantActor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): MerchantActor => {
    const actor = ctx.switchToHttp().getRequest<FastifyRequest>().actor;
    if (actor?.realm !== 'merchant') throw AppError.unauthenticated();
    return actor;
  },
);

export const CurrentPlatformActor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PlatformActor => {
    const actor = ctx.switchToHttp().getRequest<FastifyRequest>().actor;
    if (actor?.realm !== 'platform') throw AppError.unauthenticated();
    return actor;
  },
);
