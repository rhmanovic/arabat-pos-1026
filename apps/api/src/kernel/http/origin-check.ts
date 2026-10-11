import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Env } from '../../config/env.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated API calls (OWASP: verify origin with standard
 * headers), in addition to SameSite cookies: state-changing requests must come from the
 * API's own origin or a configured trusted origin.
 */
export function isTrustedOrigin(request: FastifyRequest, trusted: readonly string[]): boolean {
  if (SAFE_METHODS.has(request.method)) return true;
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite === 'cross-site') return false;
  const origin = request.headers.origin;
  // Browsers always send Origin on cross-origin writes; requests without it are non-browser clients.
  if (!origin) return true;
  if (trusted.includes(origin)) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

export function registerOriginCheck(fastify: FastifyInstance, env: Env): void {
  fastify.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (isTrustedOrigin(request, env.TRUSTED_ORIGINS)) return;
    await reply
      .status(403)
      .header('content-type', 'application/problem+json')
      .send({
        type: 'urn:arabat:error:origin_rejected',
        title: 'Request origin rejected',
        status: 403,
        code: 'ORIGIN_REJECTED',
        instance: request.url,
        requestId: String(request.id),
      });
  });
}
