---
name: run-api-locally
description: Build, migrate, seed and start the Arabat API (and optionally the Vite web apps) on this machine, sign in with the seeded demo accounts, and stop it safely. Use when you need a running local API or web app to try a change, hit an endpoint, or debug a boot failure.
---

# Run the API locally

Prepare Node 24, Docker and Postgres images first with the `sandbox-setup` skill
(Node at `~/.local/node24/bin`, `dockerd &`, `mirror.gcr.io` for `postgres:18`).
Run every command from the repo root `/home/user/arabat-pos-1026`.

## 1. Environment file

```bash
[ -f .env ] || cp .env.example .env
```

- Never add `NODE_ENV` to `.env` (Vite would bundle React's dev build; web builds refuse it).
  The API defaults to `development` when it is unset, which is what enables the demo seeds.
- Defaults: `PORT=3000`, `DATABASE_URL` = role `app_runtime` (RLS applies),
  `DATABASE_OWNER_URL` = role `app_owner` (migrations/seeds only), DB `arabat_dev` on `:5432`.

## 2. Database and build

```bash
pnpm db:up                              # docker compose up -d --wait postgres mailpit
pnpm build:packages                     # money, permissions, contracts, pos-core, device-core -> dist/
pnpm --filter @arabat/api build         # tsc -> apps/api/dist
pnpm db:migrate                         # runs apps/api/dist/database/cli/migrate.js
pnpm db:seed                            # runs apps/api/dist/database/cli/seed.js (one transaction)
```

- `db:migrate` / `db:seed` execute the **built** JS in `apps/api/dist`: always rebuild the API
  first, or new migrations/seeds are silently missing.
- `pnpm setup:local` does all of step 1–2 in one go (idempotent) but starts only `postgres`,
  not Mailpit.

## 3. Start the API

```bash
pnpm start          # = cd apps/api && node --env-file-if-exists=../../.env --enable-source-maps dist/main.js
```

- Run it in the background (Bash `run_in_background`) so the shell stays usable.
- Listens on `http://0.0.0.0:3000`, prefix `/api/v1` (log line: `API listening on ...`).
- Health: `curl -s localhost:3000/api/v1/health/live` (process only) and
  `curl -s localhost:3000/api/v1/health/ready` (pings DB; 503 + `"status":"down"` if DB unreachable).
- Watch mode instead: `pnpm --filter @arabat/api dev` (tsc --watch + `node --watch-path=dist`).
- Single origin with built SPAs: `pnpm build && SERVE_WEB=true pnpm start`
  -> `http://localhost:3000/manager/`, `/pos/`, `/platform/`.

### Testing the POS assistant
The sandbox exports `ANTHROPIC_BASE_URL` for Claude Code's tunnel and the SDK would use it.
Start the API without it (and only with the owner's approval — paid usage):

```bash
cd apps/api && env -u ANTHROPIC_BASE_URL ANTHROPIC_API_KEY=... node --env-file-if-exists=../../.env --enable-source-maps dist/main.js
```

Without `ANTHROPIC_API_KEY` the assistant is simply off.

Seen with the real model (`claude-opus-5-5`, low effort), already handled in
`modules/assistant/assistant.service.ts` / `assistant.prompt.ts` — keep these when changing the loop:
- it sometimes writes a literal `<invoke name="search_products">` text instead of calling the
  tool and repeats it until `max_tokens`: a `max_tokens` stop without a `tool_use` block returns
  `fallbackReply`, never the raw text;
- it sometimes leaks `<thinking>…</thinking>` in the reply: `textOf` strips it;
- reference numbers from the 2026-10 trial: ≈ $0.008–0.02 per question, guide cache write ≈ 1 700
  tokens; every request is stored in `assistant_requests` (platform super admin only).
Measure through `scripts/ops/assistant-trial.mjs --log var/api.log` (see `operations-runbook`).

## 4. Seeded logins (development only, `apps/api/src/database/seeds/dev-accounts.ts`)

Password for all: `Demo-Pass-2026`

| Account | Use |
|---|---|
| `owner@demo.arabat.test` | owner of "Demo Store" |
| `manager@demo.arabat.test` | manager |
| `cashier@demo.arabat.test` | cashier (POS) |
| `multi@demo.arabat.test` | manager in Demo Store, cashier in Second Shop (merchant picker) |
| `operator@platform.arabat.test` | platform operator (`/platform`), needs TOTP |

TOTP code: `pnpm --filter @arabat/api run dev:totp` (fixed dev secret, refuses in production).
Mail (password reset, invitations): Mailpit UI `http://localhost:8025`, SMTP `:1025`.
Demo seeds are skipped when `NODE_ENV` is `production` (output says `[skipped] ... not allowed`).

## 5. Web apps (Vite dev servers, `/api` proxied to `VITE_API_PROXY_TARGET` = `:3000`)

| App | Package | URL |
|---|---|---|
| manager | `@arabat/manager-web` | http://localhost:5173/manager/ |
| pos | `@arabat/pos-web` | http://localhost:5174/pos/ |
| platform | `@arabat/platform-web` | http://localhost:5175/platform/ |
| store | `@arabat/store-web` | http://localhost:5176/store/<address> |
| links | `@arabat/links-web` | http://localhost:5177/links/ |
| landing | `@arabat/landing-web` | http://localhost:5177/ |
| online | `@arabat/online-web` | http://localhost:5178/online/ |
| device | `@arabat/device-web` | http://localhost:5178/ (base `./`, needs `window.ArabatApp`) |

`pnpm dev` runs the API plus every app in parallel, but all ports are `strictPort` and
links/landing share 5177 and online/device share 5178, so one of each pair fails to start.
Start only what you need instead:

```bash
pnpm --filter @arabat/api --filter @arabat/manager-web --filter @arabat/pos-web --parallel run dev
```

## 6. Stop it safely

```bash
kill $(pgrep -f "^node --env-file")     # the API (start, dev and assistant variants)
pnpm db:down                            # optional: stop Postgres + Mailpit (data volume kept)
```

Never `pkill -f dist/main.js`: the pattern matches the calling shell's own command line and
kills it (the same happens with any `pkill -f` / `pgrep -f` pattern that appears in the same
Bash command, e.g. killing Vitest; run the kill as a separate command). Do not run `db:down`
if another agent is using Docker.

## 7. Common failures

- **`MissingAccessDeclarationError: Routes without an access declaration ...`** at boot: a
  controller method lacks `@Public`, `@Authenticated`, `@RequirePermission`,
  `@RequirePlatformRole`, `@RequirePrintAgent` or `@RequireDevice`
  (`apps/api/src/kernel/access/route-access.auditor.ts`). Add one; never default to `@Public`.
- **Missing export / old behaviour from `@arabat/money|permissions|contracts|pos-core`**: the
  API reads their `dist/`. Run `pnpm build:packages`, then rebuild the API.
- **Invalid env at startup** (zod error from `apps/api/src/config/env.ts`): check `.env`
  against `.env.example`, e.g. `MFA_ENCRYPTION_KEY` must be 32 bytes base64, `TRUST_PROXY` never `true`.
- **`/health/ready` returns 503**: Postgres not up (`pnpm db:up`) or `DATABASE_URL` wrong.
- **`relation ... does not exist`**: migrations not applied — rebuild API, `pnpm db:migrate`.
- **Login fails for demo accounts**: seeds not run, or run with `NODE_ENV=production`.
- **Port 3000 / 51xx in use**: an earlier API or Vite still runs; stop it as in step 6.
- **DI errors such as `Nest can't resolve dependencies`** after editing: an injected class was
  imported with `import type`; API code must keep value imports.
