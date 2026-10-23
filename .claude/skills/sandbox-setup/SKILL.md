---
name: sandbox-setup
description: Prepare the Claude Code cloud sandbox (Node 24, pnpm, Docker, PostgreSQL/Mailpit, Playwright Chromium) so this repo can build and run pnpm verify / test:integration / test:e2e. Use at the start of a cloud session, or when node is v22, `docker` cannot connect, an image pull returns 429, or Playwright cannot find a browser.
---

# Sandbox setup (cloud container)

Run the steps in order. Each one checks first, so re-running is safe. Verified 2026-10-23:
the whole thing takes about 2 minutes on a fresh container.

Shell state does not persist between Bash calls: **start every command that needs Node with**
`export PATH=~/.local/node24/bin:$PATH` (the default `/opt/node22` node is too old, and
`scripts/setup.mjs` refuses to run below 24).

## 1. Node 24 + pnpm

```bash
if ! ~/.local/node24/bin/node -v 2>/dev/null | grep -q '^v24\.'; then
  V=$(curl -fsS https://nodejs.org/dist/index.json | python3 -c "import json,sys; print(next(v['version'] for v in json.load(sys.stdin) if v['version'].startswith('v24.')))")
  D=$(mktemp -d); curl -fsSL "https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz" -o $D/node.tar.xz
  mkdir -p ~/.local/node24 && tar -xJf $D/node.tar.xz -C ~/.local/node24 --strip-components=1 && rm -rf $D
fi
export PATH=~/.local/node24/bin:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable && pnpm -v          # expect 12.11.2 (packageManager pin)
```

Verify: `which pnpm` → `/root/.local/node24/bin/pnpm`, `node -v` → `v24.x`.

## 2. Dependencies

```bash
cd /home/user/arabat-pos-1026 && pnpm install --frozen-lockfile   # ~10 s
```

## 3. Docker daemon

```bash
if ! docker info >/dev/null 2>&1; then
  (dockerd > /tmp/dockerd.log 2>&1 &)
  for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi
docker info --format '{{.ServerVersion}}'   # prints a version, not an error
```

The parentheses detach `dockerd` from the tool call so it survives it.

## 4. Images (Docker Hub answers 429)

`docker-compose.yml` uses `postgres:18` and `axllent/mailpit:v1.31.5`. Pull both through the
Google mirror and tag them with the compose names, so compose never contacts Docker Hub:

```bash
for img in library/postgres:18 axllent/mailpit:v1.31.5; do
  name=${img#library/}
  docker image inspect "$name" >/dev/null 2>&1 || \
    { docker pull "mirror.gcr.io/$img" && docker tag "mirror.gcr.io/$img" "$name"; }
done
docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^(postgres:18|axllent/mailpit)'
```

Integration tests may also use Testcontainers `postgres:18`; the tag above covers it.

## 5. Project setup + services

```bash
export PATH=~/.local/node24/bin:$PATH; cd /home/user/arabat-pos-1026
pnpm setup:local   # .env from .env.example (if missing), postgres up, build packages + API, migrate, seed (~30 s)
pnpm db:up         # setup:local starts only postgres; this also starts mailpit (password-reset e-mails)
docker compose ps --format '{{.Service}} {{.Status}}'   # both "(healthy)"
```

Verify setup: output ends with `Setup complete` and the seed lines `[applied] ...`.
The `arabat_test` database is migrated by the integration tests themselves
(`apps/api/src/testing/integration-env.ts`); no separate step.

Do not add `NODE_ENV` to `.env` (CLAUDE.md §9).

## 6. Playwright

Do not run `playwright install` (no download needed). Use the pre-installed Chromium:

```bash
export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium
```

`playwright.config.ts` reads it. E2E needs the full build first (`pnpm build`, ~20 s) and
starts its own API on port 3100 from `apps/api/dist/main.js`.

## 7. Smoke check (optional, ~1 min)

```bash
export PATH=~/.local/node24/bin:$PATH PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium
cd /home/user/arabat-pos-1026
pnpm vitest run --project integration apps/api/src/database/cli/bootstrap-operator.int.test.ts
pnpm build && pnpm exec playwright test e2e/apps.spec.ts --project desktop   # 9 passed
```

Then run the real gates: `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`.

## Notes

- **Disk:** ~30 GB free on `/`. Images use ~1.3 GB in `/var/lib/docker`, `node_modules` ~0.5 GB.
  If space runs low: `docker image prune -f`, delete `test-results/` and `playwright-report/`.
  `pnpm db:down` keeps data; `docker compose down -v` wipes the database (re-run `pnpm setup:local`).
- **ANTHROPIC_BASE_URL** is set in this sandbox for Claude Code's own tunnel. When testing the
  POS assistant with a real key, start the API with `env -u ANTHROPIC_BASE_URL node ...`.
- **Stopping the API:** `kill $(pgrep -f "^node --env-file")` (never `pkill -f dist/main.js`).
- **Proxy:** outbound HTTPS goes through the agent proxy; on TLS/403 errors read
  `/root/.ccr/README.md`. Never disable TLS verification. Blocked hosts seen: the staging URL
  `web-production-bf628.up.railway.app` and `api.resend.com` (use the Railway tools and the
  `Staging smoke` GitHub workflow instead); `nodejs.org`, `api.cloudflare.com` and GitHub pass.
- **Git/GitHub:** the git proxy refuses remote branch deletion (403), which matches the house
  rule (never delete a remote branch). A `workflow_dispatch` workflow can be started only when
  its file exists on the default branch; a file pushed to a side branch answers 404.
- **Waiting:** a long foreground `sleep` is refused. Wait for a condition with
  `timeout 580 sh -c 'until <check>; do sleep 15; done'` (Bash timeout 600000), or run the
  poll with `run_in_background` and wait for its notification.
- After a container restart, re-run every step: each skips what is still there (the checks are cheap).
  The first symptom of a restart (also after "Try again" / a usage-limit pause) is integration
  tests failing with `connect ECONNREFUSED 127.0.0.1:5432` or e2e with "API did not start":
  `dockerd` and the compose services are gone, not the tests. Steps 3–5 bring them back; Node,
  `node_modules` and the Docker images under `/var/lib/docker` usually survive.
