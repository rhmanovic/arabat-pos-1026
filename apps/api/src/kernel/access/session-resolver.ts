import type { AppInterface } from '@arabat/contracts';
import type { MerchantActorAccess, PlatformRole } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export type Actor =
  | {
      realm: 'merchant';
      interface: 'manager' | 'pos';
      userId: string;
      merchantId: string;
      /** Branch bound to a POS session (AUTH.md §2.1). */
      boundBranchId: string | null;
      access: MerchantActorAccess;
    }
  | {
      realm: 'platform';
      interface: 'platform';
      operatorId: string;
      role: PlatformRole;
    };

/** Resolves the authenticated actor of a request for an interface, or null. */
export abstract class SessionResolver {
  abstract resolve(request: FastifyRequest, appInterface: AppInterface): Promise<Actor | null>;
}

/**
 * Milestone M0 resolver: no session store exists yet, so no request is ever authenticated.
 * Combined with the default-deny AccessGuard this guarantees that nothing except explicitly
 * public routes is reachable. Replaced by the database-backed session resolver in M1.
 */
@Injectable()
export class NoSessionStoreResolver extends SessionResolver {
  resolve(): Promise<Actor | null> {
    return Promise.resolve(null);
  }
}
