# ADR-0112 — Local-first POS on registered devices

- **Date:** 2026-10-17 · **Status:** Accepted (owner, 2026-10-17, with the decisions in
  "Owner decisions" and the gaps A–D). Server side built in the same session, see
  "Implementation"; the device contract is `docs/DEVICE_API.md`.
- **Related:** ADR-0004 (RLS), ADR-0090/0091 (cash ledger), ADR-0100/0101 (selling controls,
  copies), ADR-0105 (Google Cloud), ADR-0111 (print agents and server print jobs).

## Context

Today the till is online-only. Every decision is taken by the server at the moment of the sale
(`apps/api/src/modules/sales/sales.service.ts`, `completeSaleInTx`): it locks the cashier's open
shift, re-prices the cart from the catalog and refuses a different `expectedTotal`
(`TOTAL_CHANGED`), refuses stock shortages (`INSUFFICIENT_STOCK`), checks supervisor grants
online (`POST /pos/overrides`) and draws the receipt number from one gap-free counter per branch
(`receipt_sequences`). A POS session is a server cookie (`pos_sid`, 8 h idle / 16 h absolute,
`apps/api/src/modules/auth/session-policy.ts`) and unlocking the screen checks the password on
the server. Without a connection nothing can be sold.

The owner wants selling to keep working without internet. A native "Arabat" app (Mac first,
later iPad, Android and Windows) will run the selling logic on the device with a local SQLite
database and synchronise in the background. The server stays the system of record and the only
place for management (products, prices, users, roles, branches). The device side is built by a
separate developer who does not edit this repository; this ADR and `packages/pos-core` are the
contract between the two.

## Decision

### 1. Local-first always

On the native device app, every sale, shift, cash movement, refund and print is completed on
the device first, against its local database, whether or not the device is online. Sync uploads completed records and
downloads reference data. There is no separate online / offline mode and no "try the server
first" path: the same code runs in both cases, so the offline path is exercised every day.

### 2. Devices and registers

- A device registers **once**, online: a manager signs in on the device with e-mail and password
  (the existing two-step login) and picks the branch. The server creates a `pos_devices` row and
  returns a device token, exactly like print agents (ADR-0111): 256-bit, shown once, only its
  SHA-256 stored, sent as `Authorization: Bearer <token>`.
- A registered device **is a register** bound to one branch: registration creates (or adopts) a
  `registers` row with `device_id`; the device's shifts and cash movements belong to it.
- Registering a device needs `registers.manage` at the branch (company-wide for none).
- A manager can **revoke** a device from `/manager` (a "Devices" list next to Registers and
  Receipt printers). Revocation takes effect at the device's next connection: the sync endpoints
  answer 401 `DEVICE_REVOKED`, the device stops selling, keeps its unsent records and shows that it
  must be registered again. Records the device completed before the revocation are still accepted
  (they happened while it was authorised); the upload answers which ones were taken.

### 3. Cashier login without internet

- Every sync downloads the **branch staff list**: membership id, name, status, the permissions
  they hold at the branch (resolved server-side from roles and assignments) and their **PIN hash**.
  The PIN is stored on the server only as a salted slow hash (**argon2id**, memory ≥ 64 MiB,
  t ≥ 3; or bcrypt cost ≥ 12 where argon2id is not available on the device), never the plain PIN.
- The cashier picks their name and types the PIN; the device verifies it **locally** against the
  hash. No server call is needed.
- Limits, stated to the owner:
  - a new employee cannot sign in on a device until that device has synced once after the
    employee got a PIN;
  - deactivation, a changed PIN or changed permissions take effect at the device's next sync.
- Security:
  - 3 wrong PINs (5 until Plan A, 2026-10-19) lock that user on that device for 5 minutes
    (doubling on repeat), counted on the device;
  - the PIN hash is never uploaded back and never shown;
  - every sign-in, sign-out, lock, failed PIN and lock-out is recorded locally and uploaded to
    `audit_log` (actor = membership, `details.deviceId`);
  - the device keeps its database encrypted at rest (OS keychain-protected key, SQLCipher or the
    platform equivalent). A 6-digit PIN hash can still be brute-forced offline by someone holding
    the device's data file, so PINs are **at least 6 digits** and a stolen device must be revoked
    (which also makes the server refuse its token).
- **Nobody but the cashier knows their PIN** (owner decision 6, 2026-10-19, replacing the earlier
  manager-set PIN): on the till's sign-in screen the cashier picks their name and presses
  "Set / reset PIN"; the device asks the server (`POST /device/pin-reset`, device token, one request
  per person per 5 minutes) and a single-use link valid for one hour goes to the cashier's own
  e-mail; the public page behind it (`/pos/pin?token=…`, `POST /device/pin-reset/complete`) sets the
  PIN. Both steps are audited (`employee.pin_reset_requested`, `employee.pin_set`, never the value).
  A manager cannot set or see a PIN; `DELETE /manager/employees/:id/pin` (`employees.manage`) only
  clears one (someone left, a PIN may have leaked), audited `employee.pin_cleared`.
- **Supervisor overrides** (BR-177): when a sale needs a right the cashier lacks, a supervisor
  present at the till types **their own PIN** on the device. The device checks that the
  supervisor holds the permission at the branch (from the downloaded permissions), records an
  override with the supervisor, the rights used and the note, and uploads it with the sale; the
  manager reviews it (the sale is flagged "supervised", as today).

### 4. Receipt numbering

- Device sales always use a **per-device series**: `{branch code}-{register code}-{6 digits}`,
  for example `MAIN-R1-000123`, gap-free per device (the device keeps its own counter in the same
  local transaction as the sale).
- **Register codes are never reused (gap C):** every device registration takes the next code of
  the branch (`R1`, `R2`, …) from a per-branch counter that only grows, skipping codes manual
  registers already use. A wiped or re-registered device gets a new register and a new code, so
  it can never repeat a receipt number.
- The server does not renumber device sales; it checks the number's prefix is the device's
  `{branch}-{register}-`, and `(merchant_id, receipt_number)` stays unique.
- The current branch-wide counter (`MAIN-000028`, `receipt_sequences`) stays for the online store
  and for browser sales until question 2 below is decided.
- Refund numbers stay `{receipt number}-R{n}`.

### 5. Server acceptance of device records

- The server **accepts** a completed device sale. It does not refuse it for stock or price: the
  device's price at sale time is final and the record carries the **catalog version** it was
  priced with (`catalogVersion` from the snapshot).
- Stock may go negative through device sales whatever `inventory_settings.allow_negative_stock`
  says; each sale that drives a balance below zero raises a manager alert (a "stock exceptions"
  list on the dashboard), and the movement is recorded like any sale.
- The server still refuses what cannot be a valid record: wrong merchant or branch for the device,
  unknown variant, totals that do not add up (`total = subtotal − discounts`, payments = total),
  a cashier who was not a member of the branch when the sale happened. Refused records are kept
  and listed for the manager instead of being lost.
- Rules that depend on the moment (shift open, discount limits, override validity) are decided by
  the device with `packages/pos-core` and the downloaded settings; the server records the device's
  decision (`above_limit`, override) instead of re-deciding it.

### 6. Ids and exactly-once ingest

- The device generates **UUIDv7** ids for sales, sale lines (position keys stay), payments,
  shifts, cash movements, refunds and overrides, so a record has the same id on the device and on
  the server.
- Every uploaded record also carries the existing `idempotencyKey`; the server ingests each record
  exactly once (same key and same content → the stored result; same key and different content →
  `IDEMPOTENCY_CONFLICT`, as today).

### 7. Sync

- **(a) Download** `GET /api/v1/device/sync?since=<version>` (device token): a versioned snapshot
  of the branch, then deltas since the device's last version. Content: categories, products,
  variants with prices and costs, barcodes, branch availability (`sellable`), payment methods,
  sales settings (discount and price limits, tender rules, held-sale expiry), inventory policy,
  staff with PIN hashes and permissions, the device's register, receipt header / footer, the
  device's own counters as last seen by the server, `offlineLimitHours`. Every response carries
  `catalogVersion`. Products come as deltas (changed since `since`, with a 5-minute overlap);
  everything else is complete in every response. Modifiers and recipes are **not** sent: retail
  sales carry no modifiers (they are restaurant-only, decision 3) and recipes only drive stock
  consumption, which the server computes at ingest.
- **(b) Upload** `POST /api/v1/device/sync` (device token): batches of completed records in
  causal order (shift open → sales / cash movements / refunds → shift close). The server runs the
  **same ledger code** as today's checkout (`StockLedgerService.apply`, `cash-ledger.ts`
  `postEntries`, audit, `PrintJobsService.queueAutoInTx`), each record in its own transaction,
  and answers per record: `accepted` (with the server's ids if any), `duplicate` or `refused`
  (with the reason).
- **No direct database replication** (PowerSync, logical decoding or similar): replication reads
  bypass Row-Level Security (ADR-0004) and would put tenant isolation in sync rules instead of the
  database, and the device would write tables without the ledger code. Cloud SQL also has logical
  decoding off today (`cloudsql.logical_decoding` not set).

### 8. Reports

Shift reports (X during the shift, Z at close) are produced on the device from local data with
`packages/pos-core`. The server's shift report is rebuilt from the uploaded records and is the one
used for cash custody. Cross-branch and company reports stay on the server.

### 8a. Printing (gap A)

The device prints its own receipts. Ingesting a device sale does **not** queue an automatic
server print job (no double printing), unless the uploaded sale says `requestRemotePrint: true`
(a device without a printer); then the job is queued for the branch's print agents as for a
browser sale.

### 8b. Clock (gap B)

Every record carries the device's `occurredAt`; the server stores it and its own `receivedAt`.
Business dates (shift, sale and refund times, report days) use `occurredAt`. A record whose
`occurredAt` is more than 10 minutes after the upload time, or whose `occurredAt` lies outside its
shift, is accepted and **flagged** (`clock_skew`) in the managers' exceptions list.

### 8c. Shared rules guard (gap D)

`pnpm verify` and CI bundle `packages/pos-core` with esbuild for the browser platform
(`scripts/ci/check-pos-core-browser.mjs`); a Node built-in, NestJS, Drizzle, `pg`, Fastify or
Socket.IO import fails the build.

### 9. What stays server-only

Product, price, staff, role and branch management; PIN setting; device registration and
revocation; cash custody between registers, treasuries and banks; transfers and purchasing;
cross-branch and financial reports; month close; the online store.

## Owner decisions (2026-10-17)

1. **Offline limit:** a company setting (`sales_settings.offline_limit_hours`), default **72 hours**
   without a successful sync. The device shows a yellow warning after 24 h, a red warning after
   48 h and stops selling at the limit until it syncs. The snapshot carries `offlineLimitHours`.
2. **Browser POS** (`/pos` in a normal browser) stays **online-only**, exactly as today
   (server-decided sale, branch-wide receipt series). Local-first is for the native app only.
3. **Restaurant module** (open orders, tables, kitchen) stays **online-only**; it is out of scope
   for device sync and a future phase. Device snapshots therefore carry no modifiers; recipes stay on
   the server, which expands stock consumption when it ingests a device sale.
4. **Device refunds:** a device refunds only sales **it made itself** (it has them locally); a
   refund of another register's sale uses the online flow. The server refuses an uploaded refund of
   another device's sale (`refused`, `NOT_OWN_SALE`).
6. **PIN ownership (2026-10-19):** the manager is out of it; the cashier sets or resets their own
   PIN from the till through a link to their e-mail (section 3). Manager-set PINs are removed.
5. **One supervisor rule:** the till's "does this cart need a supervisor" check
   (`apps/pos-web/src/sale/cart.tsx`) now uses `requiredSaleRights` from `packages/pos-core`, the
   server's rule.

## Consequences

- Selling works without internet; the server becomes an ingest point for completed records
  instead of the decision point for every sale.
- Accepting device sales means accepting negative stock and prices from an older catalog
  version; both become visible exceptions for managers instead of refusals at the till.
- Rules must be identical on the device and on the server: they live in `packages/pos-core`
  (pure TypeScript, no NestJS, no database, no Node-only APIs), which both import.
- New server work (not started): `pos_devices`, device registration and revocation, PIN
  hashes and the PIN field, the sync download / upload endpoints, per-device receipt series,
  device override records, stock exception alerts.
- Offline PIN verification puts PIN hashes on the device; device encryption, 6-digit PINs and
  revocation are the mitigations.

## Implementation

- `packages/pos-core` (2026-10-17): the selling rules extracted from `apps/api` without behavior
  change; the server and the browser till call it. Public API in `packages/pos-core/README.md`.
- Server side (2026-10-17): devices and registration, PINs, sync download and upload, exceptions,
  per-device receipt series. Contract: `docs/DEVICE_API.md`; progress: `docs/PROGRESS.md`.
  Device side (2026-10-19): `packages/device-core` (engine) and `apps/device-web` (the till),
  published at `/device-app/` with `manifest.json`; the receipt template moved to `pos-core` so both
  print one document; E2E `e2e/device.spec.ts` with the fake bridge against the real server.
  Code: `apps/api/src/modules/devices/` (`devices.service.ts` registration, `device-sync.service.ts`
  download, `device-ingest.service.ts` upload, `device-exceptions.service.ts`), migrations
  0052–0055. Choices made while building it:
  - The record's own UUIDv7 id is its idempotency key (no separate key); `device_records` keeps
    every upload, accepted or refused, with its payload.
  - Devices record only pay-ins / pay-outs ("other"); custody moves stay online (§9). Refunds go
    through the refunds engine with the device's approval reasons and approver recorded.
  - The server re-prices a device sale only from the device's own unit prices and discounts
    (`priceCart`) to check that the figures add up; it never compares with its own catalog.
  - A suspended company's devices get 403 `MERCHANT_SUSPENDED` on download; uploads of records made
    before are still accepted.
- Plan A (2026-10-19): device roles (one primary per branch), the primary as the branch's print
  agent, owner role / branch changes, the browser POS's name + PIN sign-in, 3-attempt PIN lock,
  1-minute sync. Summary in `docs/DECISIONS.md` (ADR-0112 amendment 2); contract in
  `docs/DEVICE_API.md` §2 and §2b.

