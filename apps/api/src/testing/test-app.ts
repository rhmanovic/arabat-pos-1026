import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';
import { AppModule } from '../app.module.js';
import { configureApp, createAdapter } from '../bootstrap.js';
import { type Env, loadEnv } from '../config/env.js';
import { type Actor, SessionResolver } from '../kernel/access/session-resolver.js';

export const TEST_ACTOR_HEADER = 'x-test-actor';

/** Test-only resolver: reads the actor from a header. Never registered in the real app. */
export class HeaderSessionResolver extends SessionResolver {
  resolve(request: FastifyRequest): Promise<Actor | null> {
    const raw = request.headers[TEST_ACTOR_HEADER];
    return Promise.resolve(typeof raw === 'string' ? (JSON.parse(raw) as Actor) : null);
  }
}

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    // Port 1 is never listening: database calls fail fast unless a real URL is given.
    DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none',
    ...overrides,
  });
}

export async function createTestApp(
  options: {
    env?: Env;
    controllers?: Type[];
    sessionResolver?: SessionResolver;
  } = {},
): Promise<NestFastifyApplication> {
  const env = options.env ?? testEnv();
  const builder = Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
    controllers: options.controllers ?? [],
  });
  if (options.sessionResolver)
    builder.overrideProvider(SessionResolver).useValue(options.sessionResolver);
  const moduleRef = await builder.compile();
  const { adapter } = createAdapter(env);
  const app = moduleRef.createNestApplication<NestFastifyApplication>(adapter, { logger: false });
  await configureApp(app, env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
