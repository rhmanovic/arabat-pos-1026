import { verifyPinHash } from '@arabat/device-core';

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, (ok: boolean) => void>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./pin.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean }>) => {
        waiting.get(event.data.id)?.(event.data.ok);
        waiting.delete(event.data.id);
      };
      worker.onerror = () => {
        for (const resolve of waiting.values()) resolve(false);
        waiting.clear();
        worker = null;
      };
    } catch {
      worker = null;
    }
  }
  return worker;
}

/** Verifies a PIN in the Web Worker; on the main thread where workers are unavailable. */
export function verifyPin(hash: string, pin: string): Promise<boolean> {
  const w = getWorker();
  if (!w) return verifyPinHash(hash, pin);
  return new Promise((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    w.postMessage({ id, hash, pin });
  });
}
