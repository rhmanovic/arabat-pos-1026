import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, URL-safe. Used for sessions, tickets and reset links. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only token hashes are stored, so a database leak does not reveal usable tokens. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
