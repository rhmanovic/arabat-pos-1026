import { verifyPinHash } from '@arabat/device-core';

/** Argon2id verification off the UI thread (64 MiB, 3 passes take a moment on a tablet). */
self.onmessage = async (event: MessageEvent<{ id: number; hash: string; pin: string }>) => {
  const { id, hash, pin } = event.data;
  const ok = await verifyPinHash(hash, pin);
  self.postMessage({ id, ok });
};
