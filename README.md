# Arabat POS

Multi-tenant Point of Sale and Business Management SaaS platform.

Three separate applications on one origin:

| Path        | Application                         | Dev server                       |
|-------------|-------------------------------------|----------------------------------|
| `/manager`  | Business management dashboard       | http://localhost:5173/manager/   |
| `/pos`      | Employee cashier (touch, barcode)   | http://localhost:5174/pos/       |
| `/platform` | SaaS operator administration        | http://localhost:5175/platform/  |
| `/store`    | Public online store (per merchant)  | http://localhost:5176/store/<address> |
| `/api/v1`   | Backend API (NestJS + Fastify)      | http://localhost:3000/api/v1/    |

Start with [CLAUDE.md](CLAUDE.md) and the documents in [docs/](docs/).
Current status: see [docs/PROGRESS.md](docs/PROGRESS.md).
Development accounts (created by `pnpm db:seed`, development only; password
`Demo-Pass-2026`): `owner@demo.arabat.test`, `manager@demo.arabat.test`,
`cashier@demo.arabat.test`, `multi@demo.arabat.test` (two companies), platform
operator `operator@platform.arabat.test` (TOTP code: `pnpm --filter @arabat/api run dev:totp`).
E-mails (password reset) are captured by Mailpit: http://localhost:8025.

## Requirements

- Node.js **24 LTS** (see `.nvmrc`) with Corepack enabled: `corepack enable`
  (pnpm 12 is pinned in `package.json` → `packageManager`).
- Docker with Docker Compose (local PostgreSQL 18).

## First-time setup

```bash
corepack enable
pnpm install
pnpm setup:local      # creates .env, starts PostgreSQL, builds, migrates, seeds
```

`pnpm setup:local` is idempotent. Manual equivalent:

```bash
cp .env.example .env
pnpm db:up            # docker compose up -d --wait postgres
pnpm build:packages && pnpm --filter @arabat/api build
pnpm db:migrate       # as role app_owner
pnpm db:seed          # reference data (currencies)
```

## Daily development

```bash
pnpm db:up            # if PostgreSQL is not running
pnpm dev              # API (watch) + four Vite dev servers; /api is proxied to :3000
```

## Production-like run (single origin)

```bash
pnpm build
SERVE_WEB=true pnpm start     # http://localhost:3000/manager/ , /pos/ , /platform/
```

## Quality checks

```bash
pnpm verify             # lint + format check + typecheck + build + unit/web tests
pnpm test               # unit (packages, API) + web (React apps) tests
pnpm test:integration   # API + real PostgreSQL (needs pnpm db:up && pnpm db:migrate)
pnpm test:e2e           # Playwright against the built apps (needs pnpm build)
```

Details: [docs/TESTING.md](docs/TESTING.md). Troubleshooting: see "Gotchas" in
[CLAUDE.md](CLAUDE.md).

## Useful commands

| Command | Purpose |
|---|---|
| `pnpm db:generate` | Generate a SQL migration from Drizzle schema changes (review it by hand) |
| `pnpm db:down` | Stop local services (data is kept in the `postgres-data` volume) |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |
| `pnpm typecheck` | TypeScript in every workspace project |
