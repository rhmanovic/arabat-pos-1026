import type { AppInterface } from '@arabat/contracts';
import type { MerchantActorAccess, PlatformRole } from '@arabat/permissions';
import type { FastifyRequest } from 'fastify';

export type MerchantActor = {
  realm: 'merchant';
  interface: 'manager' | 'pos';
  sessionId: string;
  userId: string;
  merchantId: string;
  membershipId: string;
  /** Branch bound to a POS session (AUTH.md §2.1); null for manager sessions. */
  boundBranchId: string | null;
  access: MerchantActorAccess;
};

export type PlatformActor = {
  realm: 'platform';
  interface: 'platform';
  sessionId: string;
  operatorId: string;
  role: PlatformRole;
};

export type Actor = MerchantActor | PlatformActor;

/** Resolves the authenticated actor of a request for an interface, or null. */
export abstract class SessionResolver {
  abstract resolve(request: FastifyRequest, appInterface: AppInterface): Promise<Actor | null>;
}
