---
name: frontend-conventions
description: Conventions for writing React code in the web apps (apps/*-web) and the shared web packages (ui, web-core, i18n, api-client) — folders, TanStack Query + ApiError handling, permission guards, ar/en i18n, RTL-safe Tailwind, accessibility and web tests. Use whenever you add or change a page, component, route, form, translation string or web test.
---

# Frontend conventions

Stack in use: React 19, react-router 8, TanStack Query 5, react-hook-form + zod, i18next,
Tailwind 4, Radix via `@arabat/ui`. No Zustand, TanStack Table or lucide (docs/ARCHITECTURE.md
header list). For colours, `vibe.css` and dark mode see the `ui-theme` skill; for a new app see
`new-web-app`; for storefront/online/links work see `online-store`; for the till see `device-app`.

## 1. Folders (follow apps/manager-web)

- `src/main.tsx` (fonts, styles, `<AppRoot appInterface i18n>`, `createBrowserRouter(routes,
  { basename })`); `src/routes.tsx` exports the whole tree so tests render it;
  `src/layouts/<App>Layout.tsx`; `src/app/` (`useSession`, `navigation.ts`).
- `src/features/<feature>/<Name>Page.tsx` (+ `shared.tsx`, `<feature>.test.tsx` beside it).
  pos-web and platform-web use `src/pages/` instead; match the app you are in.
- `src/i18n/{index,en,ar}.ts` — the app's own strings.
- Shared code goes to `packages/ui` (presentational, no API) or `packages/web-core`
  (providers, auth, guards, API-aware components). Both are source-only (CLAUDE.md §8).

## 2. Data fetching and errors

- Get the client with `useApi()` (packages/web-core/src/api-context.tsx); call typed methods
  from `packages/api-client/src/client.ts` (`api.periods.list()`). Never call `fetch` directly;
  add a method + Zod contract in `packages/contracts` instead.
- Server state is TanStack Query only. Query keys are `as const` arrays starting with the app
  name and exported: `export const periodsKey = ['manager', 'periods'] as const`
  (features/periods/PeriodsPage.tsx). Dependent queries use `enabled:`.
- After a mutation, `await queryClient.invalidateQueries({ queryKey })`, then `notify.ok(t(...))`.
- Errors: `useNotify().fail(error)` for mutations, `<ErrorState error onRetry />` for queries
  (packages/web-core/src/components.tsx). Both localize by `ApiError.code` through
  `common:errors.<CODE>` and show the `requestId`. Add new codes to
  `packages/i18n/src/locales/{en,ar}.ts` under `errors`.
- Branch on a specific code only with `error instanceof ApiError && error.code === '...'`
  (`error.problem.issues` holds details), as in features/branches/BranchesPage.tsx.
- Do not override retry: `createQueryClient` retries only 5xx/NetworkError and re-reads the
  session on 401 / `SESSION_LOCKED` (api-context.tsx).
- Money arrives as `{ amount: string, currency }`: use `Money.fromJSON` + `formatMoney`; never
  `parseFloat`/`Number` on amounts (ESLint `no-restricted-globals`, ADR-0005, CLAUDE.md §3.11).

## 3. Guards and permission-based hiding (UX only — the API decides)

- Protected tree: `<RequireAuth><Layout/></RequireAuth>`; login routes use
  `RedirectIfAuthenticated`; every top-level route has `errorElement: <RouteErrorBoundary />`
  (packages/web-core/src/guards.tsx, apps/manager-web/src/routes.tsx).
- Page routes: `guard('catalog.read', <ProductsPage />)` = `<RequirePermission>`.
  Inside a page hide actions with `useSession().can('x.manage')` (app/context.tsx) or
  `useAuth().hasPermission`. Nav items declare `anyOf` (app/navigation.ts).
- Hiding is never security: the endpoint must declare the same permission (CLAUDE.md §3.5, §4;
  docs/AUTH.md). Never send `merchantId`/tenant ids from the client (CLAUDE.md §3.10).

## 4. i18n (ADR-0014)

- `createI18n({ namespace, resources })` (packages/i18n/src/i18n.ts): default ns = the app's,
  fallback ns = `common`. `useTranslation()` then `t('periods.title')`; shared strings
  (`actions.*`, `status.*`, `errors.*`) resolve from common automatically.
- Write the English file first and type Arabic against it:
  `export const managerAr: ManagerResources = {...}` (apps/manager-web/src/i18n/ar.ts).
  Every app test asserts key parity with `flattenKeys` (apps/manager-web/src/app.test.tsx).
- Every visible string, `aria-label`, `title` and placeholder goes through `t()`.
- Plurals: write `key_one` / `key_other` and call `t('key', { count })`; Arabic
  `_zero/_two/_few/_many` are filled from `_other` by `completeArabicPlurals` — spell them out
  only when the Arabic wording differs.
- Formatting: `formatMoney(money, i18n.language)` and `formatDateTime(iso, i18n.language)`
  from `@arabat/i18n` (Latin digits, OQ-012; `ar-KW-u-nu-latn`). Bilingual records:
  `localizedName(entity, i18n.language)` from web-core. Never hand-build number strings.
- Never compute report periods from the browser clock; the server cuts them (BR-184).

## 5. RTL / LTR

- `applyDocumentLanguage` sets `<html lang dir>`; layouts must mirror from that alone.
- Logical utilities only: `ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/rounded-s`.
  ESLint rejects `ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right`
  in string and template literals (eslint.config.js `PHYSICAL_DIRECTION_CLASS`).
- Transforms and directional icons: use `ltr:` / `rtl:` variants
  (`ltr:-translate-x-1/2 rtl:translate-x-1/2`, packages/ui/src/dialog.tsx).
- Codes, phones, e-mails, SKUs, Latin names: `dir="ltr"` on the input; Arabic names `dir="rtl"`
  (BranchesPage.tsx form).

## 6. UI primitives — reuse before writing markup (`@arabat/ui`, packages/ui/src/index.ts)

`Button Card* Input Label Field Textarea Select Checkbox Tabs/TabPanel Dialog ConfirmDialog
Alert Badge StatusDot EmptyState Icon Kbd Menu* PageHeader StatCard Section Segmented Spinner
DataTable(loading/error/empty/caption/hideBelow) useToast cn`; web-core adds `ErrorState
AccessDenied NotFound FullPageLoader LanguageSwitcher useNotify localizedName`. Forms:
`useForm({ resolver: zodResolver(contractSchema) })` +
`<Field label error>{(p) => <Input {...p} {...form.register('code')} />}</Field>`.

## 7. Accessibility

- `Field` wires `id`, `htmlFor`, `aria-invalid`, `aria-describedby`; always pass its render
  props to the control. Give every `DataTable` a `caption`, every `Spinner` a `label`.
- Icon-only buttons need a translated `aria-label`; `Icon` is `aria-hidden`.
- Use `Dialog`/`Menu`/`Tabs` (Radix: focus trap, keyboard) instead of custom popups.
- Query by role + name in tests; if that fails, fix the markup, not the test.

## 8. Build gotchas

- Never put `NODE_ENV` in `.env`; every web `vite.config.ts` refuses to build with a
  non-production value (CLAUDE.md §9).
- Fonts stay separate files (`assetsInlineLimit` in vite.config.ts; CSP `font-src 'self'`):
  self-host via `@fontsource/*` (packages/ui/src/fonts.ts), never a CDN or `data:` URI.

## 9. Web tests

Vitest project `web` (jsdom, `vitest.web-setup.ts` adds jest-dom, cleanup and clears storage)
picks up `apps/*-web/src/**/*.test.tsx` and the four web packages. Run with
`pnpm vitest run --project web <path>`; see `run-tests` for everything else. Render the real
route tree with a fake API from `@arabat/web-core/testing` (packages/web-core/src/testing.tsx):

```tsx
import { fakeApiFetch, makeSession, problem, renderApp } from '@arabat/web-core/testing';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';

beforeEach(async () => { await i18n.changeLanguage('en'); });
it('closes a month and reports a refused close', async () => {
  const fetch = fakeApiFetch({
    session: makeSession('manager', ['manager.access', 'reports.financial', 'periods.close']),
    routes: {
      'GET /manager/periods': () => ({ status: 200, body: { periods: [/* … */] } }),
      'POST /manager/periods/2026-09/close': () => problem(409, 'PERIOD_NOT_CLOSABLE'),
    },
  });
  renderApp({ routes, appInterface: 'manager', i18n, path: '/periods', fetch });
  expect(await screen.findByRole('heading', { name: 'Period close' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /close/i }));
  expect(fetch.calls.some((c) => c.method === 'POST')).toBe(true);
});
```

Cover per feature: permission absent → `AccessDenied`/hidden action, an `ApiError` path, and
one Arabic render (`changeLanguage('ar')`, check `document.documentElement.dir === 'rtl'`).
Paths/bodies above are illustrative: copy the real ones from the contracts and client.
