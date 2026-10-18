import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AppInterface } from '@arabat/contracts';

/** The storefront (`/store`) is a public app, not an authenticated interface (ADR-0076). */
const APPS: Record<AppInterface | 'store', string> = {
  manager: 'manager-web',
  pos: 'pos-web',
  platform: 'platform-web',
  store: 'store-web',
};

/**
 * Serves the built SPAs from one origin (production-like local run and E2E tests):
 * `/manager/*`, `/pos/*`, `/platform/*`, `/store/*`, each with its own index.html fallback,
 * and the landing pages at `/` and `/pricing`.
 * In production a CDN/reverse proxy may serve these files instead (ARCHITECTURE.md §12).
 */
export async function serveWebApps(fastify: FastifyInstance): Promise<void> {
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
    fastify.get(`/${appInterface}/*`, sendIndex);
  }

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
}
