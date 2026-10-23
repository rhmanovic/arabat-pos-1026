import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppInterface } from '@arabat/contracts';

/**
 * The storefront (`/store`) is a public app, not an authenticated interface (ADR-0076); the
 * link-page editor (`/links`, ADR-0116 amendment 1) and the online store console (`/online`,
 * ADR-0119) sign in with the manager session.
 */
const APPS: Record<AppInterface | 'store' | 'links' | 'online', string> = {
  manager: 'manager-web',
  pos: 'pos-web',
  platform: 'platform-web',
  store: 'store-web',
  links: 'links-web',
  online: 'online-web',
};

/**
 * Serves the built SPAs from one origin (production-like local run and E2E tests):
 * `/manager/*`, `/pos/*`, `/platform/*`, `/store/*`, `/links/*`, `/online/*`, each with its own index.html fallback,
 * and the landing pages at `/` and `/pricing`.
 * In production a CDN/reverse proxy may serve these files instead (ARCHITECTURE.md §12).
 */
/** The link-preview tags of a storefront address (ADR-0134), or null for the plain page. */
export type StoreMeta = (path: string, query: URLSearchParams) => Promise<string | null>;
/** Stores at their own sub-domain (ADR-0136). */
export type StoreHosts = {
  /** The store a request's host stands for, or null. */
  slugOfHost: (host: string | undefined) => string | null;
  /** A store's address at its sub-domain, or null when its address cannot be one. */
  subdomain: (slug: string) => string | null;
};

/** Paths under `/store/` that are not a store (sandbox payments, link pages, files). */
const STORE_APP_PATHS = ['pay', 'links', 'assets'];

export async function serveWebApps(
  fastify: FastifyInstance,
  options: { storeMeta?: StoreMeta; stores?: StoreHosts } = {},
): Promise<void> {
  let first = true;
  for (const [appInterface, folder] of Object.entries(APPS)) {
    const root = fileURLToPath(new URL(`../../../${folder}/dist`, import.meta.url));
    if (!existsSync(root))
      throw new Error(`SERVE_WEB is enabled but ${root} does not exist. Run pnpm build first.`);

    await fastify.register(fastifyStatic, {
      root,
      prefix: `/${appInterface}/`,
      wildcard: false,
      decorateReply: first,
      index: false,
      setHeaders(res, filePath) {
        res.header(
          'cache-control',
          filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
    first = false;

    const sendIndex = (_req: unknown, reply: FastifyReply) =>
      reply.header('cache-control', 'no-cache').sendFile('index.html', root);
    fastify.get(`/${appInterface}`, (_req, reply) => reply.redirect(`/${appInterface}/`));
    fastify.get(`/${appInterface}/`, sendIndex);
    // A missing hashed asset is a real 404, never the HTML shell (avoids confusing MIME errors).
    fastify.get(`/${appInterface}/assets/*`, (request, reply) =>
      reply
        .status(404)
        .header('content-type', 'application/problem+json')
        .send({
          type: 'urn:arabat:error:not_found',
          title: 'Not found',
          status: 404,
          code: 'NOT_FOUND',
          instance: request.url,
          requestId: String(request.id),
        }),
    );
    if (appInterface === 'store' && options.storeMeta) {
      // Link previews (WhatsApp and others read tags without running scripts): the store's
      // page is sent with its title, description and picture already in (ADR-0134).
      const html = readFileSync(join(root, 'index.html'), 'utf8');
      const storeMeta = options.storeMeta;
      const stores = options.stores;
      fastify.get(`/${appInterface}/*`, async (request: FastifyRequest, reply: FastifyReply) => {
        const url = new URL(request.url, 'http://store.local');
        const [slug = '', ...rest] = url.pathname.replace(/^\/store\/?/, '').split('/');
        const hostSlug = stores?.slugOfHost(request.headers.host) ?? null;
        if (stores && hostSlug) {
          // `/store/{slug}/…` typed on the store's own host: its address there is `/…`.
          if (request.originalUrl.startsWith('/store/') && slug === hostSlug)
            return reply.redirect(`/${rest.join('/')}${url.search}`, 301);
        } else if (stores && slug && !STORE_APP_PATHS.includes(slug)) {
          // The old address moves to the store's sub-domain, except inside the console's
          // preview frame, which must stay on the console's origin (ADR-0128).
          const target = stores.subdomain(slug);
          if (target && request.headers['sec-fetch-dest'] !== 'iframe')
            return reply.redirect(`${target}/${rest.join('/')}${url.search}`, 301);
        }
        const tags = await storeMeta(url.pathname, url.searchParams).catch(() => null);
        let page = tags ? html.replace(/<title>[^<]*<\/title>/, tags) : html;
        // On its own host the storefront runs at `/` and learns its store from this tag.
        if (hostSlug && slug === hostSlug)
          page = page.replace(
            '</head>',
            `<meta name="arabat-store" content="${hostSlug}" />\n  </head>`,
          );
        return reply
          .header('cache-control', 'no-cache')
          .header('content-type', 'text/html; charset=utf-8')
          .send(page);
      });
      continue;
    }
    fastify.get(`/${appInterface}/*`, sendIndex);
  }

  // The local-first till bundle for the native Arabat app (ADR-0112): the app reads
  // `manifest.json` (never cached), downloads the listed files and serves them itself.
  const deviceApp = fileURLToPath(new URL('../../../device-web/dist', import.meta.url));
  if (!existsSync(deviceApp))
    throw new Error(`SERVE_WEB is enabled but ${deviceApp} does not exist. Run pnpm build first.`);
  await fastify.register(fastifyStatic, {
    root: deviceApp,
    prefix: '/device-app/',
    wildcard: false,
    decorateReply: false,
    index: false,
    setHeaders(res, filePath) {
      res.header(
        'cache-control',
        filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });
  fastify.get('/device-app', (_req, reply) => reply.redirect('/device-app/'));
  const sendDeviceIndex = (_req: unknown, reply: FastifyReply) =>
    reply.header('cache-control', 'no-cache').sendFile('index.html', deviceApp);
  fastify.get('/device-app/', sendDeviceIndex);
  fastify.get('/device-app/*', sendDeviceIndex);

  // The public landing page (ADR-0113) owns `/`: its built files are registered one by one
  // (wildcard: false), so no catch-all route shadows `/api` or the apps above.
  const landing = fileURLToPath(new URL('../../../landing-web/dist', import.meta.url));
  if (!existsSync(landing))
    throw new Error(`SERVE_WEB is enabled but ${landing} does not exist. Run pnpm build first.`);
  await fastify.register(fastifyStatic, {
    root: landing,
    prefix: '/',
    wildcard: false,
    decorateReply: false,
    index: false,
    setHeaders(res, filePath) {
      res.header(
        'cache-control',
        filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });
  fastify.get('/', (_req, reply) =>
    reply.header('cache-control', 'no-cache').sendFile('index.html', landing),
  );
  // The pricing page (ADR-0114) is a second page of the landing build.
  fastify.get('/pricing', (_req, reply) =>
    reply.header('cache-control', 'no-cache').sendFile('pricing.html', landing),
  );
  fastify.get('/pricing/', (_req, reply) => reply.redirect('/pricing'));
  // The free-trial sign-up funnel (ADR-0115).
  fastify.get('/start', (_req, reply) =>
    reply.header('cache-control', 'no-cache').sendFile('start.html', landing),
  );
  fastify.get('/start/', (_req, reply) => reply.redirect('/start'));
}
