import 'reflect-metadata';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { pino } from 'pino';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import { ProblemDetailsFilter } from './kernel/errors/problem.filter.js';
import { registerOriginCheck } from './kernel/http/origin-check.js';
import { genRequestId } from './kernel/http/request-id.js';
import { PinoNestLogger, createLoggerOptions } from './kernel/logging/logger.js';
import { serveWebApps } from './web/serve-web.js';

export const API_PREFIX = 'api/v1';

export function createAdapter(env: Env) {
  const logger = pino(createLoggerOptions(env));
  const adapter = new FastifyAdapter({
    loggerInstance: logger,
    genReqId: genRequestId,
    requestIdHeader: false,
    bodyLimit: 1024 * 1024,
    // Only configured proxies may set the client IP (rate limits, audit).
    // Fastify accepts a hop count too; the Nest adapter's type omits it.
    trustProxy: env.TRUST_PROXY as boolean | string[],
  });
  return { adapter, logger };
}

/** Applies the HTTP pipeline shared by the real server and API tests. */
export async function configureApp(app: NestFastifyApplication, env: Env): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
    if (request.url.startsWith('/api/')) void reply.header('cache-control', 'no-store');
  });
  registerOriginCheck(fastify, env);

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        // Only behind TLS in production; on http://localhost it would break asset loading.
        upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null,
      },
    },
  });
  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, {
    limits: { fileSize: 2 * 1024 * 1024 + 1, files: 1, fields: 5 },
  });

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();

  if (env.SERVE_WEB) await serveWebApps(fastify);
}

/** Builds the fully configured application (used by main.ts). */
export async function createApp(env: Env): Promise<NestFastifyApplication> {
  const { adapter, logger } = createAdapter(env);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(env), adapter, {
    logger: new PinoNestLogger(logger.child({ context: 'nest' })),
    // Payment webhooks verify signatures over the exact bytes received.
    rawBody: true,
  });
  await configureApp(app, env);
  return app;
}
