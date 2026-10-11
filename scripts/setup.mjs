#!/usr/bin/env node
// One-time local setup: env file, PostgreSQL, build, migrations, seeds.
// Usage: pnpm setup:local (safe to re-run; migrations and seeds are idempotent)
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';

const run = (command) => {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: 'inherit' });
};

const [major] = process.versions.node.split('.').map(Number);
if (major < 24) {
  console.error(
    `Node.js 24 LTS or newer is required (found ${process.versions.node}). See .nvmrc.`,
  );
  process.exit(1);
}

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log('Created .env from .env.example (local development values).');
}

run('docker compose up -d --wait postgres');
run('pnpm build:packages');
run('pnpm --filter @arabat/api build');
run('pnpm db:migrate');
run('pnpm db:seed');

console.log('\nSetup complete. Start everything with: pnpm dev');
console.log('  Manager  http://localhost:5173/manager/');
console.log('  POS      http://localhost:5174/pos/');
console.log('  Platform http://localhost:5175/platform/');
console.log('  API      http://localhost:3000/api/v1/health/ready');
