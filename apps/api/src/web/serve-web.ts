import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AppInterface } from '@arabat/contracts';

const APPS: Record<AppInterface, string> = {
  manager: 'manager-web',
  pos: 'pos-web',
  platform: 'platform-web',
};

/**
 * Serves the three built SPAs from one origin (production-like local run and E2E tests):
 * `/manager/*`, `/pos/*`, `/platform/*`, each with its own index.html fallback.
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
  fastify.get('/', (_req, reply) => reply.redirect('/manager/'));
}
