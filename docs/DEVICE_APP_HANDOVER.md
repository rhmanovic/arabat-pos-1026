# Arabat device app — handover to the native app developer

Status 2026-10-19. Everything below is live in production (`https://www.arabatapp.com`), built,
tested and deployed from this repository. The native side (Mac first) is yours; the web till it
loads, the server it talks to and the rules it applies are ours and are described here.

Read with: `docs/DEVICE_API.md` (the exact HTTP contract), `docs/adr/ADR-0112-local-first-pos.md`
(the decisions), `packages/pos-core/README.md` (the selling rules both sides run).

## 1. What the native app does (unchanged, as agreed)

1. Exposes `window.ArabatApp` (bridge version **2**) to the page: `device.info()`, `db.*`
   (SQLite: `exec`, `query`, `transaction`), `api.*` (`register`, `request`, `isRegistered`,
   `forget`), `print.receipt(html)`, `printer.status()`, `app.applyUpdate()`, `app.log()`, plus the
   window events `arabat:printer` and `arabat:update-ready`. Money and 64-bit integers travel as
   strings; errors reject with `Error` whose message starts with a code (`DB_ERROR: …`,
   `NOT_REGISTERED`, `NETWORK: …`, `PRINTER_UNAVAILABLE`, `PRINT_FAILED: …`, `FORBIDDEN_ORIGIN`,
   `BAD_REQUEST: …`).
2. Keeps the device token natively: `api.register` stores it and strips it from the body; every
   `api.request` adds `Authorization: Bearer <token>`; `api.forget` deletes it. The token never
   reaches JavaScript.
3. Downloads the bundle: `GET https://www.arabatapp.com/device-app/manifest.json`
   (`Cache-Control: no-cache`) →
   `{ version, entry: "index.html", files: [{ path, sha256, size }] }`; downloads every file,
   verifies the SHA-256 and size, keeps it on disk, serves it from `arabat://app/<path>` and
   falls back to the entry for unknown paths. A new `version` → download, verify, then fire
   `arabat:update-ready` `{ version }`; the page calls `app.applyUpdate()` at a safe moment.
4. Until the manifest exists the app shows the online `/pos` page. It exists now.

The page never uses cookies or `fetch` to the server and never calls `window.print()`.

## 2. What the page does (ours: `apps/device-web`, engine `packages/device-core`)

Screens, in order of use:

| Screen | Behaviour |
|---|---|
| Not in app | `window.ArabatApp?.bridgeVersion !== 2` → "Open this in the Arabat app". |
| Register | E-mail + password of a manager (`registers.manage`) + device name → `api.register`; when more than one company / branch is possible, a picker, then `api.register` again with `merchantId` / `branchId`; then the role (**primary** till with the cash drawer, one per branch, or **additional**) and `api.register` with `role`. On success: first full sync. |
| Sign-in (lock) | Staff list from the last sync; the cashier picks their name and types their PIN on the pad. Verified **locally** (argon2id, Web Worker). 3 wrong PINs lock that person on the device for 5 minutes, doubling. Idle lock after 5 minutes without input. **"Set / reset PIN"** button → `POST /device/pin-reset` → the cashier gets a link by e-mail and chooses the PIN on `https://www.arabatapp.com/pos/pin?token=…`; the till receives the new hash at its next sync. Nobody else ever knows a PIN. |
| Open shift | Counted drawer cash → local shift + `shift_open` record. One open shift per device. |
| Sell | Search / barcode / categories, cart, line and sale discounts, price change with a reason, supervisor PIN when the cart needs rights the cashier lacks, split tenders (cash with change, card / transfer with reference), zero-total reason. Decisions through `@arabat/pos-core` with the downloaded settings and permissions (same code as the server). Receipt number `{branch}-{register}-NNNNNN`, gap-free, taken in the same SQLite transaction as the sale. Printed with `print.receipt(html)` using the server's receipt template. Pay-in / pay-out, recent sales with reprint. |
| Refunds | Only this device's sales; amounts, pay-back and approval reasons by `pos-core`; a second person approves with their PIN when needed. |
| Close shift | Counted cash; X / Z summary from local records; `shift_close` record. |
| Status strip | Synced / N waiting / N not accepted, last sync time, offline warnings (24 h yellow, 48 h red, stop at the company limit, default 72 h), printer state (`arabat:printer`), app and bundle version, "Sync now", the list of records the server refused, the update banner. |

Sync: upload the outbox in causal order (batches ≤ 200, byte-identical bodies on retry; results
`accepted` / `duplicate` / `refused`), then download (`?since=` deltas), at start, 1.5 s after a
new record, after each upload, every minute, and from the "Sync now" button. `401 DEVICE_REVOKED` → stop selling, keep unsent
records, `api.forget()`, show "register again". `403 MERCHANT_SUSPENDED` → stop selling.

Local database (SQLite through `db.*`): `meta`, snapshot tables (`payment_methods`, `staff`,
`categories`, `products`, `variants`, `barcodes`), records (`shifts`, `sales`, `sale_lines`,
`payments`, `cash_movements`, `refunds`, `refund_lines`, `refund_payments`), `outbox`,
`pin_attempts`, `guard`. Schema version in `meta.schemaVersion`; migrations run at every start.
Money is TEXT (fils), booleans INTEGER 0/1, times ISO TEXT. `PRAGMA foreign_keys = ON`, WAL.

## 3. Server endpoints the page calls (all through `api.*`)

| Call | Purpose |
|---|---|
| `POST /device/register` | Registration (public; manager credentials). |
| `GET /device/me` | Token check. |
| `GET /device/sync[?since=]` | Snapshot / deltas, `offlineLimitHours`, `catalogVersion`, counters. |
| `POST /device/sync` | Upload `{ records }` → per-record `accepted` / `duplicate` / `refused`. |
| `POST /device/pin-reset` | `{ membershipId }` → 202; e-mails the cashier a one-hour link (429 within 5 minutes). |
| `POST /device/pin-reset/complete` | Used by the public page `/pos/pin`, not by the device. |

Full shapes, refusal codes and an example session: `docs/DEVICE_API.md`.

## 4. How to test without the native app

- `pnpm vitest run --project unit packages/device-core`: engine tests (snapshot apply, outbox
  order / retry / idempotency, gap-free counter under failure, PIN lockout, offline limit).
- `pnpm vitest run --project web apps/device-web`: the flow in jsdom with the fake bridge.
- `pnpm test:e2e e2e/device.spec.ts`: Playwright against the real server with the fake bridge
  (`@arabat/device-core/testing`: in-memory sql.js, API with the token, recorded prints):
  register → full sync → PIN through the e-mailed link → open shift → sale → upload accepted →
  retry gives duplicate → refund → close shift.
- A fake bridge for a normal browser: `createFakeBridge({ baseUrl })` from
  `packages/device-core/src/testing`, installed as `window.ArabatApp` before the page loads
  (`e2e/device-bridge.entry.ts` shows how).

## 5. Manual check of a new build of the native app

1. Open the app with no token: the registration screen appears (not "Open this in the Arabat
   app"). Register with a manager account; the branch picker appears when needed.
2. The staff list appears within seconds (first sync). Pick a name without a PIN → "Set / reset
   PIN" → the e-mail arrives → choose the PIN on the phone → "Sync now" on the till → sign in.
3. Open a shift, sell for cash with change, the receipt prints on the till printer; the sale
   appears in `/manager` within a few minutes; the status strip shows "Synced".
4. Turn the network off: selling, pay-outs, refunds of this device's sales and the shift close
   keep working; the strip shows "N waiting". Turn it on: "Synced".
5. Remove the device in `/manager/devices`: the next sync shows "removed, register again"; unsent
   records stay listed.
6. Publish a new bundle (any merge to `main` deploys one): `arabat:update-ready` fires, the
   banner appears, "Update now" (or automatic with an empty cart and nobody signed in) reloads.

## 6. Not on the device (online only, by decision)

Restaurant (tables, kitchen), customers, exchanges and voids, custody cash moves (safe drops,
deposits, expenses, supplier payments), gateway payments, product images, held sales across tills.
A pay-out above the company limit is allowed on the device for the owner only.

## 7. Changes of Plan A (2026-10-19)

What changes for the native side:

1. **Device role.** `device.role` (`primary` | `secondary`) is in the registration answer, in
   `GET /device/me` and in every snapshot. Kick the cash drawer **only on a primary device**, after
   a receipt the page prints during a cash sale. A secondary device never kicks it. The owner can
   change the role or move the device later from `/manager/devices`; the next sync carries it (no
   new registration, no new token).
2. **The primary device is the branch's print agent.** With its device token (the one you already
   keep), connect to Socket.IO `/print-agent` and use `GET /print-agent/jobs/pending`,
   `POST /print-agent/jobs/:id/claim` and `/result` exactly as a print agent (DEVICE_API.md §2b).
   These jobs are the browser POS's receipts: print them on the till printer and **never** open the
   drawer for them (`openDrawer: false`). A secondary device gets 403 there: do not connect it.
   Keep the connection while the app runs; reconnect with back-off; after each reconnect read
   `pending`. Re-check `device.role` after each sync and connect / disconnect accordingly.
3. **PIN lock after 3 wrong PINs** (was 5), handled by the page.
4. **Sync every minute** while online (was 3 minutes), plus the "Sync now" button; handled by the
   page.

Nothing changes in the bridge methods (bridge version stays 2). The socket connection for print
jobs is native (the page cannot hold the token): the page needs no new bridge call for it.

