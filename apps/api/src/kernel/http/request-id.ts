import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Reuses a well-formed inbound `x-request-id` (from the proxy) or generates a new one. */
export function genRequestId(request: IncomingMessage): string {
  const inbound = request.headers['x-request-id'];
  return typeof inbound === 'string' && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();
}
