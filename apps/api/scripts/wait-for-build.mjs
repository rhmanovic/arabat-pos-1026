// Waits until the first TypeScript watch build has produced dist/main.js (used by `pnpm dev`).
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const target = new URL('../dist/main.js', import.meta.url);
for (let i = 0; i < 600 && !existsSync(target); i++) await sleep(100);
if (!existsSync(target)) {
  console.error('dist/main.js was not produced by the TypeScript build');
  process.exit(1);
}
