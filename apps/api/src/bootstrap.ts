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
import { trustProxyOption } from './kernel/http/client-ip.js';
import { registerOriginCheck } from './kernel/http/origin-check.js';
import { genRequestId } from './kernel/http/request-id.js';
import {
  domainAddress,
  ownHosts,
  storeHostRewrite,
  storeSlugFromHost,
} from './kernel/http/store-host.js';
import { PinoNestLogger, createLoggerOptions } from './kernel/logging/logger.js';
import { StoreAddressService } from './modules/ecommerce/store-address.service.js';
import { StoreShareService } from './modules/ecommerce/store-share.service.js';
import { serveWebApps } from './web/serve-web.js';

export const API_PREFIX = 'api/v1';

export function createAdapter(env: Env) {
  const logger = pino(createLoggerOptions(env));
  const adapter = new FastifyAdapter({
    loggerInstance: logger,
    genReqId: genRequestId,
    requestIdHeader: false,
    bodyLimit: 1024 * 1024,
    // Only configured proxies may set the client IP (rate limits, audit); behind the hop count,
    // Cloudflare's own hop too (store sub-domains, ADR-0136). Fastify accepts a function; the
    // Nest adapter's type omits it.
    trustProxy: trustProxyOption(env.TRUST_PROXY) as boolean | string[],
    // A store's sub-domain (ADR-0136) or a merchant's own domain (ADR-0137) shows the store at `/`.
    ...(env.SERVE_WEB && (env.STORE_DOMAIN || env.CUSTOM_HOSTNAMES_DRIVER !== 'off')
      ? {
          rewriteUrl: storeHostRewrite({
            storeDomain: env.STORE_DOMAIN,
            own: env.CUSTOM_HOSTNAMES_DRIVER !== 'off' ? ownHosts(env) : null,
          }),
        }
      : {}),
  });
  return { adapter, logger };
}

/** Applies the HTTP pipeline shared by the real server and API tests. */
export async function configureApp(app: NestFastifyApplication, env: Env): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
    // API answers are never cached, except where a route chose its own policy (public
    // pictures of the store: logo, banner, categories, design images).
    if (request.url.startsWith('/api/') && !reply.hasHeader('cache-control'))
      void reply.header('cache-control', 'no-store');
  });
  registerOriginCheck(fastify, env);

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // 'wasm-unsafe-eval': the device till verifies PINs with argon2id in WebAssembly.
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        // Store design videos (ADR-0128): YouTube (privacy mode), Vimeo and TikTok players.
        frameSrc: [
          "'self'",
          'https://www.youtube-nocookie.com',
          'https://player.vimeo.com',
          'https://www.tiktok.com',
        ],
        // Same-origin framing only: the console previews the storefront (ADR-0128).
        frameAncestors: ["'self'"],
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

  if (env.SERVE_WEB)
    await serveWebApps(fastify, {
      storeMeta: (path, query) => app.get(StoreShareService, { strict: false }).tags(path, query),
      ...(env.STORE_DOMAIN || env.CUSTOM_HOSTNAMES_DRIVER !== 'off'
        ? {
            stores: {
              slugOfHost: (host) => storeSlugFromHost(host, env.STORE_DOMAIN),
              find: (key) => app.get(StoreAddressService, { strict: false }).find(key),
              byDomain: (domain) =>
                app.get(StoreAddressService, { strict: false }).byDomain(domain),
              domainUrl: (domain) => domainAddress(env, domain),
            },
          }
        : {}),
    });
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
