import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HeaderSessionResolver, TEST_ACTOR_HEADER, createTestApp } from '../testing/test-app.js';
import { Public, RequirePermission, RequirePlatformRole } from './access/access.decorators.js';
import type { Actor } from './access/session-resolver.js';
import { MissingAccessDeclarationError } from './access/route-access.auditor.js';
import { ZodPipe } from './validation/zod.pipe.js';

const createThingSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().int().positive(),
});

@Controller()
class KernelTestController {
  @Public()
  @Post('test/things')
  create(@Body(new ZodPipe(createThingSchema)) body: z.infer<typeof createThingSchema>) {
    return { received: body };
  }

  @Public()
  @Get('test/boom')
  boom(): never {
    throw new Error('secret internal detail');
  }

  @RequirePermission('manager', 'manager.access')
  @Get('manager/test/branches/:branchId')
  branch(@Param('branchId') branchId: string) {
    return { branchId };
  }

  @RequirePermission('pos', 'pos.access')
  @Get('pos/test/register')
  register() {
    return { ok: true };
  }

  @RequirePlatformRole('platform.super_admin')
  @Get('platform/test')
  platform() {
    return { ok: true };
  }
}

@Controller()
class UndeclaredController {
  @Get('test/forgotten')
  forgotten() {
    return { leaked: true };
  }
}

const merchant = (
  interfaceName: 'manager' | 'pos',
  grants: { branchId: string | null; permissions: string[] }[],
  extra: Partial<Actor> = {},
): string =>
  JSON.stringify({
    realm: 'merchant',
    interface: interfaceName,
    userId: 'u1',
    merchantId: 'm1',
    boundBranchId: interfaceName === 'pos' ? 'A' : null,
    access: { membershipActive: true, merchantActive: true, isOwner: false, assignments: grants },
    ...extra,
  });

const operator = JSON.stringify({
  realm: 'platform',
  interface: 'platform',
  operatorId: 'o1',
  role: 'platform.super_admin',
});

describe('API kernel', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp({
      controllers: [KernelTestController],
      sessionResolver: new HeaderSessionResolver(),
    });
  });
  afterAll(async () => {
    await app.close();
  });

  const inject = (opts: Parameters<NestFastifyApplication['inject']>[0]) => app.inject(opts);

  describe('health', () => {
    it('reports liveness without touching the database', async () => {
      const res = await inject({ method: 'GET', url: '/api/v1/health/live' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'ok' });
    });

    it('reports 503 readiness when the database is unreachable', async () => {
      const res = await inject({ method: 'GET', url: '/api/v1/health/ready' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({
        status: 'down',
        checks: { database: { status: 'down' } },
      });
    });
  });

  describe('error handling', () => {
    it('answers unknown routes with RFC 9457 problem details and a request id', async () => {
      const res = await inject({ method: 'GET', url: '/api/v1/does-not-exist' });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
      const body = res.json();
      expect(body).toMatchObject({
        status: 404,
        code: 'ROUTE_NOT_FOUND',
        instance: '/api/v1/does-not-exist',
      });
      expect(body.requestId).toBe(res.headers['x-request-id']);
    });

    it('propagates a safe inbound request id', async () => {
      const res = await inject({
        method: 'GET',
        url: '/api/v1/health/live',
        headers: { 'x-request-id': 'edge-123' },
      });
      expect(res.headers['x-request-id']).toBe('edge-123');
    });

    it('never leaks internal error details', async () => {
      const res = await inject({ method: 'GET', url: '/api/v1/test/boom' });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(res.body).not.toContain('secret internal detail');
    });

    it('rejects malformed JSON bodies', async () => {
      const res = await inject({
        method: 'POST',
        url: '/api/v1/test/things',
        headers: { 'content-type': 'application/json' },
        payload: '{bad',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'MALFORMED_REQUEST' });
    });
  });

  describe('request validation', () => {
    it('returns field-level issues for invalid input', async () => {
      const res = await inject({
        method: 'POST',
        url: '/api/v1/test/things',
        payload: { name: '', quantity: 1.5 },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.issues.map((i: { path: string }) => i.path).sort()).toEqual(['name', 'quantity']);
    });

    it('passes parsed input to the handler', async () => {
      const res = await inject({
        method: 'POST',
        url: '/api/v1/test/things',
        payload: { name: 'Tea', quantity: 2, extra: 'x' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ received: { name: 'Tea', quantity: 2 } });
    });
  });

  describe('default-deny access control', () => {
    it.each(['manager', 'pos', 'platform'])('rejects %s/me without a session', async (iface) => {
      const res = await inject({ method: 'GET', url: `/api/v1/auth/${iface}/me` });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('rejects protected routes without a session', async () => {
      for (const url of [
        '/api/v1/manager/test/branches/A',
        '/api/v1/pos/test/register',
        '/api/v1/platform/test',
      ]) {
        expect((await inject({ method: 'GET', url })).statusCode, url).toBe(401);
      }
    });

    it('denies management routes to a cashier (BR-013)', async () => {
      const cashierOnManager = merchant('manager', [
        { branchId: 'A', permissions: ['pos.access'] },
      ]);
      const res = await inject({
        method: 'GET',
        url: '/api/v1/manager/test/branches/A',
        headers: { [TEST_ACTOR_HEADER]: cashierOnManager },
      });
      expect(res.statusCode).toBe(403);
    });

    it('denies POS routes to a manager without explicit POS access (BR-014)', async () => {
      const manager = merchant('pos', [{ branchId: null, permissions: ['manager.access'] }]);
      const res = await inject({
        method: 'GET',
        url: '/api/v1/pos/test/register',
        headers: { [TEST_ACTOR_HEADER]: manager },
      });
      expect(res.statusCode).toBe(403);
    });

    it('enforces branch scope', async () => {
      const managerAtA = merchant('manager', [{ branchId: 'A', permissions: ['manager.access'] }]);
      const ok = await inject({
        method: 'GET',
        url: '/api/v1/manager/test/branches/A',
        headers: { [TEST_ACTOR_HEADER]: managerAtA },
      });
      expect(ok.statusCode).toBe(200);
      const other = await inject({
        method: 'GET',
        url: '/api/v1/manager/test/branches/B',
        headers: { [TEST_ACTOR_HEADER]: managerAtA },
      });
      expect(other.statusCode).toBe(403);
    });

    it('rejects a session of another interface', async () => {
      const posSession = merchant('pos', [
        { branchId: null, permissions: ['manager.access', 'pos.access'] },
      ]);
      const res = await inject({
        method: 'GET',
        url: '/api/v1/manager/test/branches/A',
        headers: { [TEST_ACTOR_HEADER]: posSession },
      });
      expect(res.statusCode).toBe(403);
    });

    it('separates merchant and platform realms', async () => {
      const owner = merchant('manager', [], {
        access: { membershipActive: true, merchantActive: true, isOwner: true, assignments: [] },
      } as Partial<Actor>);
      expect(
        (
          await inject({
            method: 'GET',
            url: '/api/v1/platform/test',
            headers: { [TEST_ACTOR_HEADER]: owner },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await inject({
            method: 'GET',
            url: '/api/v1/platform/test',
            headers: { [TEST_ACTOR_HEADER]: operator },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await inject({
            method: 'GET',
            url: '/api/v1/manager/test/branches/A',
            headers: { [TEST_ACTOR_HEADER]: operator },
          })
        ).statusCode,
      ).toBe(403);
    });

    it('returns the session from /me for an authenticated actor', async () => {
      const res = await inject({
        method: 'GET',
        url: '/api/v1/auth/platform/me',
        headers: { [TEST_ACTOR_HEADER]: operator },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        interface: 'platform',
        realm: 'platform',
        actorId: 'o1',
        merchantId: null,
        boundBranchId: null,
        permissions: ['platform.super_admin'],
      });
    });
  });
});

describe('route access auditor', () => {
  it('refuses to boot when a route has no access declaration', async () => {
    await expect(createTestApp({ controllers: [UndeclaredController] })).rejects.toBeInstanceOf(
      MissingAccessDeclarationError,
    );
  });

  it('boots the real application with every route declared', async () => {
    const app = await createTestApp();
    await app.close();
  });
});
