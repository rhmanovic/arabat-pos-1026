// Writes apps/device-web/dist/manifest.json for the native Arabat app (ADR-0112): every file
// of the build with its SHA-256 and size, and a version that changes with every publish. The
// app downloads the files, verifies them and serves them from arabat://app/.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../apps/device-web/dist', import.meta.url));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(dist)
  .filter((f) => !f.endsWith('manifest.json'))
  .sort()
  .map((f) => {
    const data = readFileSync(f);
    return {
      path: relative(dist, f).split('\\').join('/'),
      sha256: createHash('sha256').update(data).digest('hex'),
      size: data.length,
    };
  });
if (!files.some((f) => f.path === 'index.html'))
  throw new Error('device-web build has no index.html');

// Content hash plus build time: a rebuild of the same sources still gets a new version.
const content = createHash('sha256')
  .update(files.map((f) => `${f.path}:${f.sha256}`).join('\n'))
  .digest('hex')
  .slice(0, 12);
const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\.\d+Z$/, 'Z');
const manifest = { version: `${stamp}-${content}`, entry: 'index.html', files };
writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`device-app manifest ${manifest.version}: ${files.length} files`);
