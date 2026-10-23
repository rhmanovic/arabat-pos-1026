---
name: new-web-app
description: Add a new React SPA under apps/ (like apps/links-web at /links or apps/online-web at /online) with its own basename, dev port, session guard, i18n, single-origin serving, tests and docs. Use when the owner asks for a separate interface/console/app, or when adding a new top-level path served by the API.
---

# Adding a new web app (`apps/<name>-web` at `/<name>`)

Templates to copy: `apps/links-web` (smallest: one page) and `apps/online-web` (sidebar, features,
theme). Both are frontend-only apps over the **manager session** (ADR-0116 amendment 1, ADR-0119).
A new *identity realm* or a new `appInterface` is a significant decision: write an ADR first (`new-adr`).
CLAUDE.md §3.4: a separate interface is a separate application, never hidden menu items.

## 1. Decide first

- Path `/<name>` (lower case, not already a route in `apps/api/src/web/serve-web.ts` or a store app
  path in `STORE_APP_PATHS`).
- Session: reuse an existing interface (`manager`, `pos`, `platform` from
  `packages/contracts/src/interfaces.ts`) via `<AppRoot appInterface=...>`. Links/online use `"manager"`
  (same cookie, no new auth code). Public apps (store-web) have no session.
- Required permission(s) from `packages/permissions` (links: `online.manage`; online: `online.manage`
  or `online.orders`). Prefer existing permissions; a new one goes through the permission catalog.
- Dev port: must be unique, every config uses `strictPort: true`. Run
  `grep -n "port:" apps/*/vite.config.ts`. Taken today: 5173 manager, 5174 pos, 5175 platform,
  5176 store, 5177 links, 5178 online, 5179 landing, 5180 device. Use 5181 or higher.

## 2. Package files (copy from `apps/links-web`)

- `package.json`: `"name": "@arabat/<name>-web"`, `"type": "module"`, scripts `dev`/`build`/`preview`/
  `typecheck` exactly as links-web; deps on `@arabat/{api-client,contracts,i18n,ui,web-core}`
  (`workspace:*`), react 19, react-router, @tanstack/react-query, i18next/react-i18next; devDeps
  `@tailwindcss/vite`, `@vitejs/plugin-react`, `tailwindcss`, `vite`. Then `pnpm install`
  (updates `pnpm-lock.yaml`; `pnpm-workspace.yaml` already globs `apps/*`).
- `tsconfig.json`: extends `../../tsconfig.web.json`, `include: ["src", "vite.config.ts"]`.
- `vite.config.ts` — keep every block of `apps/links-web/vite.config.ts`:
  - `base: '/<name>/'`;
  - the `NODE_ENV` guard that throws on `vite build` with a non-production `NODE_ENV` (CLAUDE.md §9);
  - `resolve.conditions: ['source', ...defaultClientConditions]` (web packages are source-only);
  - `server` + `preview` on your port with `strictPort: true`, and the `/api` proxy to
    `env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000'` (`loadEnv(mode, '../..', 'VITE_')`,
    `.env.example`);
  - `assetsInlineLimit` that never inlines fonts (CSP `font-src 'self'`), vendor `codeSplitting` groups.
- `index.html`: `lang="ar" dir="rtl"`, relative `./favicon.svg` and `./src/main.tsx`, a distinct
  `<title>` (e2e compares titles/bundles). `public/favicon.svg`.
- `src/styles.css`: `@import 'tailwindcss'; @import '@arabat/ui/theme.css';` plus `@source` lines for
  `packages/ui/src` and `packages/web-core/src` (online-web adds `@arabat/ui/vibe.css`, ADR-0131).
- `pnpm dev`, `pnpm build`, `pnpm typecheck` pick the app up through `./apps/*` / `-r`; nothing to add.

## 3. Entry, routing, guard, i18n

- `src/main.tsx` (see `apps/links-web/src/main.tsx`): import `@arabat/ui/fonts` and `./styles.css`,
  `createBrowserRouter(routes, { basename: '/<name>' })`, render
  `<AppRoot appInterface="manager" i18n={i18n}><RouterProvider router={router} /></AppRoot>`.
- `src/routes.tsx` (see `apps/links-web/src/routes.tsx`): `/login` inside `RedirectIfAuthenticated`,
  `/forgot-password`, `/` inside `RequireAuth` with the layout and a `*` → `NotFound`; every route has
  `errorElement: <RouteErrorBoundary />`. All from `@arabat/web-core`.
- Layout checks the permission with `useAuth().hasPermission(...)` and shows an `Alert` instead of the
  `<Outlet />` without it (`LinksLayout.tsx`, `apps/online-web/src/app/OnlineLayout.tsx`). This is UI
  only: the backend endpoints must already declare `@RequirePermission` (CLAUDE.md §3.5, §4).
- i18n: `src/i18n/{ar,en,index}.ts`; `index.ts` calls `createI18n({ namespace, resources })` from
  `@arabat/i18n` (common strings come for free). Both languages complete; logical Tailwind classes only
  (`ms-/me-/ps-/pe-`, ESLint enforces). Include `LanguageToggle`.
- Cross-app links: dev ports differ, so use `import.meta.env.DEV ? 'http://localhost:<port>/<name>/' :
  '/<name>/'` (pattern in `LinksLayout.tsx` `managerUrl()` and `apps/manager-web/src/app/navigation.ts`).
  If the manager menu should open the new app, add a `NAV` entry there with `anyOf` permissions.

## 4. Serve it from the API (single origin, production)

- Add `<name>: '<name>-web'` to `APPS` in `apps/api/src/web/serve-web.ts` (and widen its key type and
  doc comment). That gives `/<name>` → `/<name>/`, index fallback, immutable `/assets/*`, and a JSON 404
  for missing assets. Without it production and e2e serve nothing (`SERVE_WEB=true`).
- `serveWebApps` throws at boot if `apps/<name>-web/dist` is missing, so the build must produce it.
- CSP is global in `apps/api/src/bootstrap.ts` (helmet): only `'self'` scripts/fonts/connect, inline
  styles allowed, images `'self' data:`. No CDNs, no external fonts; change the CSP only with an ADR.
- Docker / Cloud Run / Railway need no change: `Dockerfile` runs `pnpm install && pnpm build` on the
  whole repo and copies `/app`; `railway.json` and `infra/gcp/deploy.sh` build that Dockerfile.
  Release with `deploy-production`.

## 5. Tests (see `run-tests`)

- Web unit: `src/app.test.tsx` using `renderApp`, `fakeApiFetch`, `makeSession` from
  `@arabat/web-core/testing` (copy `apps/links-web/src/app.test.tsx`): sign-in page, no-permission
  message, main flow in en (and RTL where relevant).
- Add `<name>` to the web project glob `apps/{manager,pos,platform,store,links,online,landing,device}-web`
  in root `vitest.config.ts`, otherwise the tests never run.
- E2E (production build): add a spec like `e2e/links.spec.ts` (register, open from the manager menu,
  same session). `e2e/apps.spec.ts` covers only manager/pos/platform; extend its interface list /
  "no browser errors" loop if the app has a sign-in screen. Run `pnpm build` before `pnpm test:e2e`.

## 6. Docs in the same session

- `docs/DECISIONS.md`: ADR for the new interface (path, session, permission, port) via `new-adr`.
- `docs/ARCHITECTURE.md`: bullet in the apps list (~line 16), repo tree (~line 135), `pnpm dev` ports (§11).
- `docs/ROUTES.md`: a `## 2x. /<name> — <name>-web` table (route, screen, permission).
- `CLAUDE.md` §8 repo map line; `README.md` URL table (lines 9–14);
  `.claude/skills/run-api-locally/SKILL.md` dev URL table; `docs/PROGRESS.md`, `docs/TESTING.md`.
- Finish with `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e` (`finish-task`).
