import type { AppInterface } from '@arabat/contracts';
import type { PermissionKey, PlatformRole } from '@arabat/permissions';
import { SetMetadata } from '@nestjs/common';

export const ACCESS_METADATA = 'arabat:access';

/**
 * Every route handler must carry exactly one access declaration. Routes without one are
 * denied at runtime and make the application refuse to boot (RouteAccessAuditor).
 */
export type AccessRule =
  | { kind: 'public' }
  | { kind: 'authenticated'; interface: AppInterface }
  | { kind: 'permission'; interface: 'manager' | 'pos'; permission: PermissionKey }
  | { kind: 'platform-role'; roles: readonly PlatformRole[] }
  | { kind: 'print-agent' };

/** Explicitly public route (health checks, login). */
export const Public = () => SetMetadata(ACCESS_METADATA, { kind: 'public' } satisfies AccessRule);

/** Requires a valid session for the given interface, without a specific permission. */
export const Authenticated = (appInterface: AppInterface) =>
  SetMetadata(ACCESS_METADATA, {
    kind: 'authenticated',
    interface: appInterface,
  } satisfies AccessRule);

/** Requires a merchant session for the interface plus a permission (AUTH.md §3). */
export const RequirePermission = (appInterface: 'manager' | 'pos', permission: PermissionKey) =>
  SetMetadata(ACCESS_METADATA, {
    kind: 'permission',
    interface: appInterface,
    permission,
  } satisfies AccessRule);

/** Requires a platform operator session with one of the roles. */
export const RequirePlatformRole = (...roles: PlatformRole[]) =>
  SetMetadata(ACCESS_METADATA, { kind: 'platform-role', roles } satisfies AccessRule);

/** Requires a print agent's bearer token (`Authorization: Bearer <token>`, ADR-0111). */
export const RequirePrintAgent = () =>
  SetMetadata(ACCESS_METADATA, { kind: 'print-agent' } satisfies AccessRule);
