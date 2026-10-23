---
name: device-app
description: Working map for the local-first till inside the native Arabat app and for receipt printing. Use for tasks touching apps/device-web, packages/device-core, packages/pos-core (selling rules, receipt template, offerAt), device sync/outbox, cashier PINs and browser-POS PIN sign-in, primary/secondary devices, print agents, print jobs and receipts.
---

# Device app, shared selling rules and printing

Read first: `docs/adr/ADR-0112-local-first-pos.md` (with amendments 2–4 summarised in
`docs/DECISIONS.md` under ADR-0112), `docs/DEVICE_API.md` (the contract), `docs/DEVICE_APP_HANDOVER.md`
(what the native developer does), and ADR-0111 in `docs/DECISIONS.md` (print agents).

## Architecture in a few lines

- The native "Arabat" app (built by a separate developer, not in this repo) hosts our web page
  `apps/device-web`, served from `arabat://app/`, with a local SQLite DB and the device token.
- Local-first always: every sale, shift, cash movement, refund and print completes on the device
  first; there is no online/offline mode switch. Sync downloads reference data (snapshot, staff +
  PIN hashes) and uploads completed records from an outbox. The server is the system of record and
  accepts completed device sales (no refusal for stock or price), see `apps/api/src/modules/devices/`.
- Engine: `packages/device-core` (schema, snapshot, outbox, sync, PIN, offline limit, catalog,
  shifts, sales, refunds, receipt). UI: `apps/device-web/src/screens/*` on top of it.
- Selling decisions: `packages/pos-core` (pure, no DB, no Node built-ins).

## The bridge contract (`window.ArabatApp`, bridge version 2)

- Defined in `packages/device-core/src/bridge.ts` (`ArabatBridge`, `findBridge()`,
  `bridgeErrorCode()`): `db.exec/query/transaction`, `api.register/request/isRegistered/forget`,
  `print.receipt(html)`, `printer.status()`, `device.info()`, `app.applyUpdate()/log()`.
- The page reaches the server **only** through `api.*`; the token never reaches JavaScript.
  No `fetch` to the API from device-web. Outside the app the page shows "Open this in the Arabat app".
- Money and 64-bit integers cross the bridge as strings. Errors are `Error`s whose message starts
  with a code (`NETWORK: …`, `NOT_REGISTERED`, `PRINTER_UNAVAILABLE`, …).
- Changing the bridge is a contract change with the native developer: update `DEVICE_API.md`,
  `DEVICE_APP_HANDOVER.md` and bump `BRIDGE_VERSION` only by an ADR decision.

## Selling rules live in pos-core (both sides must agree)

- `packages/pos-core/src/`: `sale.ts`, `amounts.ts`, `discounts.ts` (`offerAt` for product
  discounts in force), `overrides.ts`, `payments.ts`, `refunds.ts`, `shifts.ts`, `errors.ts`
  (`PosRuleError`), `receipt.ts` + `receipt-html.ts` (receipt template), `order-slip-html.ts`.
- The API calls them through `rules()` in `apps/api/src/kernel/errors/pos-rule.ts`, which maps
  `PosRuleError` to `AppError` (same status/code/message). Users include `sales/sales.service.ts`
  (`completeSaleInTx`), `sales/overrides.service.ts`, `refunds/refunds.service.ts`,
  `registers/shifts.service.ts`, `catalog/discount-offers.ts`, `devices/device-ingest.service.ts`,
  `printing/receipt-html.ts`.
- **Rule:** a change to a selling rule (price, limits, rights, tenders, shift notes, refunds,
  receipt layout) goes into `packages/pos-core`, never only into an API service or only into
  device-core, so the till and the server decide the same way. Add a case in
  `packages/pos-core/src/pos-core.test.ts`.
- pos-core and device-core must bundle for a browser: `pnpm check:pos-core-browser`
  (`scripts/ci/check-pos-core-browser.mjs`, esbuild, refuses `node:*`, `@nestjs/*`, `drizzle-orm`,
  `pg`, `fastify`, `socket.io`). Part of `pnpm verify`.
- The API consumes pos-core from `dist/`: run `pnpm build:packages` after changing it.

## Build and publish

- `apps/device-web/vite.config.ts` uses `base: './'` (relative URLs, served from `arabat://app/`);
  dev/preview port 5180. Never set `NODE_ENV` in `.env` (build refuses).
- `pnpm --filter @arabat/device-web build` = `vite build` + `scripts/build-device-manifest.mjs`,
  which writes `apps/device-web/dist/manifest.json` (each file's path, SHA-256, size, and a
  version = build time + content hash).
- The API serves the bundle at `/device-app/` and `GET /device-app/manifest.json`
  (`apps/api/src/web/serve-web.ts`, no-cache). The native app downloads, verifies, applies via
  `app.applyUpdate()`. A release of `main` publishes a new bundle to every till.

## Testing with the fake bridge

- Fake bridge: `@arabat/device-core/testing` (`packages/device-core/src/testing/fake-bridge.ts`,
  `createFakeBridge({ baseUrl })`, in-memory sql.js, API with the token, recorded prints).
- `pnpm vitest run --project unit packages/device-core` — engine (`device-core.test.ts`).
- `pnpm vitest run --project web apps/device-web` — UI flow in jsdom (`src/app.test.tsx`).
- `pnpm test:e2e e2e/device.spec.ts` — real server + fake bridge (`e2e/device-bridge.entry.ts`):
  register → sync → PIN → shift → sale → upload → duplicate retry → refund → close.
- Server side: `apps/api/src/modules/devices/devices.int.test.ts`, `device-ingest.int.test.ts`,
  `apps/api/src/modules/printing/printing.int.test.ts`,
  `apps/api/src/modules/auth/pin-sign-in.int.test.ts` (`pnpm test:integration`).

## Plan A: primary device, PINs, printing

- `pos_devices.role` `primary` | `secondary`; one live primary per branch (`409 PRIMARY_EXISTS`).
  Only the owner changes role/branch (`PUT /manager/devices/:id`). The primary holds the branch
  shift and opens the drawer; secondaries sell into it and never kick the drawer.
- **The primary device is the branch's print agent:** its device token is accepted by the
  print-agent API and socket (`@RequirePrintAgent`); a secondary gets `403 NOT_PRIMARY_DEVICE`.
  Jobs it prints (browser POS / manager receipts) carry `openDrawer: false`. The socket is native.
- Cashier PIN: set/reset by the cashier only (e-mailed link, `devices/pin-reset.service.ts`),
  stored as argon2id; devices verify locally (`packages/device-core/src/pin.ts`,
  `apps/device-web/src/app/pin.worker.ts`); 3 wrong PINs lock 5 minutes.
- Browser POS PIN sign-in through a branch link: `apps/api/src/modules/auth/pin-sign-in.service.ts`
  (`PinSignInService`) + `pin-sign-in.controller.ts` (`/manager/pin-links` to make links; only
  `branches.pin_link_key_hash` stored; key in the URL `#` and request bodies only). Frontend:
  `apps/pos-web/src/routes.tsx` (`/pin`, `/pin-sign-in`). Lists active people with `pos.access`.
- Print jobs (ADR-0111): `PrintJobsService.queueAutoInTx` in
  `apps/api/src/modules/printing/print-jobs.service.ts`, called **inside the sale's transaction**
  (`completeSaleInTx` in `sales/sales.service.ts`; device sales only on `requestRemotePrint` in
  `device-ingest.service.ts`) in a savepoint that never fails the sale; only when auto-print is on
  and the branch has an agent. After commit PostgreSQL `NOTIFY`; every API instance `LISTEN`s and
  `print-agent.gateway.ts` pushes `print:job` on Socket.IO namespace `/print-agent` (rooms per
  agent / company / branch). Claim is one conditional UPDATE (loser gets 409); stuck `printing`
  is reclaimable after 2 minutes. Print state for the browser POS: `GET /pos/sales/:id/print-status`.

## Topic → doc → files

| Topic | Doc / ADR | Files |
|---|---|---|
| Bridge | DEVICE_API.md §1, §7; HANDOVER §2 | `packages/device-core/src/bridge.ts` |
| Registration, revoke, role | ADR-0112 §2, amend. 2/4; DEVICE_API §2 | `apps/api/src/modules/devices/devices.service.ts`, `devices.controller.ts` |
| Sync download / snapshot | DEVICE_API §3 | `devices/device-sync.service.ts`; `device-core/src/snapshot.ts`, `sync.ts` |
| Sync upload / outbox | DEVICE_API §5 | `devices/device-ingest.service.ts`, `device-exceptions.service.ts`; `device-core/src/outbox.ts` |
| Local DB schema | DEVICE_API §7 | `packages/device-core/src/schema.ts` |
| Selling, refunds, shifts on device | DEVICE_API §4; amend. 3 | `device-core/src/sales.ts`, `refunds.ts`, `shifts.ts`, `offline.ts` |
| Shared rules | ADR-0112; CLAUDE.md §10 | `packages/pos-core/src/*`, `apps/api/src/kernel/errors/pos-rule.ts` |
| Receipts | ADR-0111, ADR-0112 | `pos-core/src/receipt-html.ts`, `device-core/src/receipt.ts`, `apps/api/src/modules/printing/receipt-html.ts` |
| Cashier PIN | ADR-0112 §3; DEVICE_API §2a | `device-core/src/pin.ts`, `devices/pin-reset.service.ts` |
| Browser POS PIN link | ADR-0112 amend. 2 | `apps/api/src/modules/auth/pin-sign-in.service.ts`, `apps/pos-web/src/routes.tsx` |
| Print agents / jobs | ADR-0111; DEVICE_API §2b | `apps/api/src/modules/printing/print-jobs.service.ts`, `print-agent.gateway.ts`, `printing.controller.ts` |
| Bundle publish | DEVICE_API §7 | `apps/device-web/vite.config.ts`, `scripts/build-device-manifest.mjs`, `apps/api/src/web/serve-web.ts` |
| Browser guard | — | `scripts/ci/check-pos-core-browser.mjs` |

## Checklist for a device/printing change

1. Rule change? Put it in pos-core, test it there, `pnpm build:packages`.
2. Contract change (bridge, sync payload, refusal codes)? Update `docs/DEVICE_API.md` and the
   handover doc; native app changes need the owner.
3. Run device-core unit, device-web web tests, related integration tests, `e2e/device.spec.ts`,
   then `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`.
