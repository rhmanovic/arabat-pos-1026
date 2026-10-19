import { uuidv7 } from 'uuidv7';

/** UUIDv7: the same id on the device and on the server (ADR-0112 §6). */
export function newId(): string {
  return uuidv7();
}

export const nowIso = (now: Date = new Date()) => now.toISOString();
