# Device API (local-first Arabat app)

The contract between the Arabat server and the native local-first till app (Mac first, later
iPad, Android, Windows). Decision record: `docs/adr/ADR-0112-local-first-pos.md`. Shared selling
rules: `packages/pos-core` (`packages/pos-core/README.md`). The Zod schemas in
`packages/contracts/src/devices.ts` are the source of truth for every shape below; this document
explains them.

- Base URL: `https://www.arabatapp.com/api/v1` (production). Staging and local use the same paths.
- Bodies are JSON (`content-type: application/json`), at most **1 MiB** per request.
- **Money** on the device wire is an integer number of **fils as a decimal string** (`"1250"` =
  1.250 KWD), never a float. Field names end in `Minor`. Quantities are decimal strings with up to
  3 decimals (`"2"`, `"0.5"`).
- Times are ISO 8601 with an offset (`2026-10-17T08:15:00.000Z`).
- Ids the device creates are **UUIDv7**.
- Errors are RFC 9457 problem responses (`application/problem+json`):
  `{ type, title, status, code, detail?, issues?: [{ path, code, message }] }`. Use `code`.

## 1. Authentication

| What | How |
|---|---|
| Device token | 256-bit random, 43 characters base64url, returned **once** at registration. Store it in the OS keychain. The server keeps only its SHA-256. |
| Every device call | `Authorization: Bearer <token>` |
| No / unknown token | `401` `UNAUTHENTICATED` |
| Removed device | `401` `DEVICE_REVOKED`: stop selling, keep unsent records, show "register again". A removed device never works again; registering again creates a new device with a new register code. |
| Suspended company | `GET /device/sync` answers `403` `MERCHANT_SUSPENDED`: stop selling. |

The device never holds a user session. Cashiers sign in **on the device** with their PIN, checked
locally (section 4).

## 2. Registration (online, once)

`POST /device/register` (public; the credential is the manager's e-mail and password; rate-limited
like a sign-in: 30 per IP per 10 min, 10 failures per e-mail per 15 min → `429` `RATE_LIMITED`).

The person must hold `registers.manage` at the branch (the owner always does).

Request:

```json
{ "email": "owner@example.com", "password": "…", "deviceName": "Front till",
  "merchantId": "optional uuid", "branchId": "optional uuid" }
```

1. Send `email`, `password`, `deviceName` only. If the person can register at exactly one branch of
   one company, the device is registered straight away. Otherwise the answer lists the choices:

   ```json
   { "status": "select_branch",
     "merchants": [ { "id": "…", "nameEn": "Arabat Café", "nameAr": "مقهى عربات",
                      "branches": [ { "id": "…", "code": "MAIN", "nameEn": "Main", "nameAr": "الرئيسي" } ] } ] }
   ```

2. Send the same request again with `merchantId` and `branchId`:

   ```json
   { "status": "registered",
     "device": { "id": "…", "name": "Front till", "merchantId": "…", "branchId": "…",
                 "branchCode": "MAIN", "code": "D1", "registerId": null, "registerCode": null,
                 "registerName": null, "role": "secondary" },
     "token": "q3V…43 chars" }
   ```

**A device is a selling device, a register is a cash drawer** (ADR-0112 amendment 4).
Registration creates no register. The device gets a permanent `code` in its branch (`D1`, `D2`, …
from a counter that only grows; codes are never reused, even after removal): its receipt series
is `{branch}-{code}-NNNNNN`. Errors: `401` `INVALID_CREDENTIALS`, `403` `ACCOUNT_DISABLED`,
`403` `FORBIDDEN` (no `registers.manage` there), `404` (inactive branch).

`GET /device/me` → the `device` object above. Use it to check the token.

**Binding (managers, `/manager/registers` or `/manager/devices`):** a manager binds a register
(cash drawer) of the branch to exactly one device: `PUT /manager/devices/:id { registerId }` or
`PUT /manager/registers/:id/device { deviceId }` (null unbinds; `409 REGISTER_BOUND` when another
device holds it, `409 REGISTER_BUSY` while the register's shift is open). The bound device is that
register's **primary**: `device.registerId`, `registerCode` and `registerName` are set and
`device.role` is `primary` (derived; `secondary` when unbound). It opens and closes the register's
shift with a cash count, takes cash, opens the drawer, records pay-ins / pay-outs and prints the
browser POS's receipts (§2b). Nothing is revoked by a binding change; the device learns it from
`device` in its next sync. Removing a device frees its register.

**Branch move (owner only, `PUT /manager/devices/:id { branchId }`):** the device must be unbound
(`409 REGISTER_BOUND`); it gets a new `code` in the new branch, hence a new receipt series from
`000001`, and the next `GET /device/sync?since=…` is a **full** snapshot of the new branch. The
device engine resets its receipt counter whenever `device.code` or `device.branchId` changes.

**Cash drawer.** The native app kicks the drawer only when `device.registerId` is set (a bound
device), after a receipt the page prints itself (`print.receipt(html)` during a cash sale). An
unbound device never kicks it. Queued jobs from the server (§2b) never open the drawer
(`openDrawer: false`).

## 2a. Cashier PINs (self-service)

Nobody but the cashier knows their PIN; the manager is not involved. From the sign-in screen
(the cashier's name selected, device online):

`POST /device/pin-reset` (device token) `{ "membershipId": "…" }` → `202 { "status": "accepted" }`.
A single-use link valid for **one hour** goes to the member's own e-mail
(`https://www.arabatapp.com/pos/pin?token=…`); the page behind it asks for the PIN twice and calls
`POST /device/pin-reset/complete` `{ token, pin }` (public, 6–12 digits, not one repeated digit, not
a straight run; `400 RESET_TOKEN_INVALID` when the link is used, expired or unknown). The device
receives the new `pinHash` at its next sync. A second request for the same person within 5 minutes
answers `429 RATE_LIMITED`; a request for someone who is not an active member of the device's
company still answers 202 and sends nothing. Show the cashier: "if your e-mail is on file, a link
is on its way; the till picks the new PIN up at its next sync".

## 2b. The bound device prints the browser POS's receipts

A device **bound to a register** (its primary) is also a print agent of its branch, with its own
device token — no separate print-agent token. It uses the print-agent API of ADR-0111 unchanged:

- Socket.IO namespace `/print-agent` (path `/socket.io`), `auth: { token: <device token> }`; the
  server pushes `print:job { id }` for jobs of the device's branch.
- `GET /print-agent/jobs/pending` → `[{ id, html, orderUuid, createdAt, openDrawer: false }]`
  (also after every reconnect).
- `POST /print-agent/jobs/:id/claim` → `{ id, html, openDrawer: false }` (`409` when another
  printer claimed it), then print the HTML on the receipt printer **without** kicking the drawer.
- `POST /print-agent/jobs/:id/result` `{ ok: true }` or `{ ok: false, error }`. A job id is printed
  at most once: a second claim answers 409.

An unbound device's token gets `403 NOT_PRIMARY_DEVICE` there (the socket is refused with
`forbidden: …`); a revoked token, 401. When a manager unbinds the device or the owner moves it,
its socket is disconnected. Branches without a bound device keep using standalone print agents
(`/manager/printers`). The browser POS shows each receipt's state (waiting / printed / failed)
from `GET /pos/sales/:id/print-status`.

## 3. Sync download

`GET /device/sync` (full snapshot) or `GET /device/sync?since=<version>` (changes since a
snapshot). Call it at start-up, after every successful upload and every few minutes while online.

```json
{
  "version": "2026-10-17T08:15:00.123Z",
  "full": true,
  "catalogVersion": "2026-10-17T07:58:41.902Z",
  "serverTime": "2026-10-17T08:15:00.123Z",
  "offlineLimitHours": 72,
  "device":   { "id": "…", "name": "Front till", "merchantId": "…", "branchId": "…", "branchCode": "MAIN", "code": "D1",
                "registerId": "…", "registerCode": "R1", "registerName": { "nameEn": "Main drawer", "nameAr": "الصندوق الرئيسي" }, "role": "primary" },
  "merchant": { "id": "…", "nameEn": "Arabat Café", "nameAr": "مقهى عربات", "currency": "KWD", "timezone": "Asia/Kuwait" },
  "branch":   { "id": "…", "code": "MAIN", "nameEn": "Main", "nameAr": "الرئيسي", "phone": null, "address": null, "receiptHeader": null, "receiptFooter": "Thank you" },
  "register": { "id": "…", "code": "R1", "nameEn": "Main drawer", "nameAr": "الصندوق الرئيسي", "defaultOpeningFloatMinor": "0", "discrepancyToleranceMinor": "0" },
  "settings": {
    "maxDiscountPercent": "10", "priceOverrideFloorPercent": "50", "priceOverrideCeilingPercent": "200",
    "priceOverrideBelowCost": false, "requireTenderReference": true, "blindCashCount": true,
    "cashOutOtherLimitMinor": "20000", "cashOutOtherShiftLimitMinor": "50000",
    "refundWindowDays": 30, "refundApprovalLimitMinor": "20000", "refundOwnSalesNeedApproval": true,
    "allowNegativeStock": false, "heldSaleExpiryHours": 24
  },
  "counters": { "lastReceiptNumber": "MAIN-D1-000041" },
  "branchShift": { "id": "…", "status": "open", "registerId": "…", "registerCode": "R1",
                   "openedAt": "2026-10-17T08:00:00.000Z", "closedAt": null,
                   "openedBy": { "membershipId": "…", "userId": "…", "fullName": "Sara" } },
  "primaryDevice": { "id": "…", "name": "Front till" },
  "paymentMethods": [ { "id": "…", "kind": "cash", "status": "active", "availableInPos": true, "gatewayProvider": null,
                        "financialAccountId": null, "nameEn": "Cash", "nameAr": "نقدي", "feeType": "none",
                        "feeFixedMinor": "0", "feePercent": "0", "sortOrder": 0 } ],
  "staff": [ { "membershipId": "…", "userId": "…", "fullName": "Sara", "isOwner": false,
               "pinHash": "$argon2id$v=19$m=65536,t=3,p=1$…", "permissions": ["pos.access", "sales.create", "…"] } ],
  "priceOffers": [ { "variantId": "…", "discountId": "…", "priceMinor": "200", "startsAt": null, "endsAt": "2026-11-01T00:00:00.000Z" } ],
  "categories": [ { "id": "…", "parentId": null, "nameEn": "Drinks", "nameAr": "مشروبات", "sortOrder": 0, "status": "active" } ],
  "products": [ { "id": "…", "categoryId": "…", "nameEn": "Tea", "nameAr": "شاي", "type": "standard",
                  "trackInventory": false, "sellable": true, "updatedAt": "…",
                  "variants": [ { "id": "…", "nameEn": null, "nameAr": null, "sku": "TEA-1", "priceMinor": "250",
                                  "costMinor": "80", "isDefault": true, "status": "active", "barcodes": ["6281000000017"] } ] } ]
}
```

- `version`: opaque cursor. Store it after applying the response and send it as `since` next time.
  An unknown `since` gives a full snapshot (`full: true`).
- `full: true`: every collection is complete; replace local data. `full: false`: **products** are
  only those changed since `since` (re-sent products replace the local copy; a few unchanged ones
  may be re-sent). **Every other collection is always complete** (settings, payment methods, staff,
  categories, branch, register).
- `device.code`: the device's permanent code (its receipt series). `device.registerId` /
  `registerCode` / `registerName` and `register`: the cash drawer a manager bound to this device,
  **null when unbound** (then: card / transfer only, no drawer, no cash in / out, no shift of its
  own). `device.role` is derived from it (`primary` when bound).
- `sellable: false`: archived, or no longer sold at this branch. Hide it from selling; keep it for
  old receipts. A variant with `status: "archived"` is not sold either.
- `catalogVersion`: record it on every sale priced with this catalog (§5).
- `staff`: active people who may use the POS at this branch, with every permission they hold
  **at this branch** (keys of `@arabat/permissions`; check rights with `permissions.includes(key)`).
  People without a PIN (`pinHash: null`) cannot sign in on devices. Someone missing from the list
  (removed, deactivated, moved) must be signed out.
- `counters.lastReceiptNumber`: the highest receipt number of this register the server has. After
  restoring a device from scratch with the same token, continue above it.
- `branchShift` / `primaryDevice` (amendments 3 and 4, always complete). A **bound** device gets
  the latest shift of its own register (open or closed, with who opened it): it learns here when
  a manager closed its shift online. An **unbound** device gets the open register shift it sells
  into — the branch's main register's, else the oldest open one — or `null`, when it shows "no
  open shift at the branch" and cannot sell. `primaryDevice` is the device bound to the main
  register (else to that shift's register), or `null`.
- Payment methods: offer those with `status: "active"`, `availableInPos: true` and no
  `gatewayProvider` (gateway payments are online only).
- `priceOffers` (ADR-0133, always complete): every discounted price at the point of sale, with
  its dates (running and scheduled). Replace the local set; sell at the offer in force at the
  moment of the sale (`offerAt` in `@arabat/pos-core`; `catalogAt` in `@arabat/device-core`):
  the lowest price wins, start inclusive, end exclusive.
- Not in the snapshot: product images, customers, modifiers and recipes (restaurant only, online
  only; recipes are expanded by the server when it ingests a sale), held sales of other tills.

## 4. Rules the device applies

| Topic | Rule |
|---|---|
| Offline limit | Count hours since the last **successful** sync (download or upload). Yellow warning after 24 h, red after 48 h, **stop selling** at `offlineLimitHours` until a sync succeeds. |
| PIN | Verify with argon2id against `pinHash` (PHC string: 64 MiB, 3 passes, 1 lane). 3 wrong PINs lock that person on that device for 5 minutes, doubling on repeat (Plan A). Never upload or display the hash. |
| Selling | Price and check every sale with `@arabat/pos-core` and the downloaded `settings` / `staff[].permissions`, in the order in `packages/pos-core/README.md` (rights, `evaluateSale`, `checkPayments`). Pass `expectedTotalMinor: null`. |
| Supervisor | When `requiredSaleRights` lists rights the cashier lacks, a supervisor types **their own PIN**; check the right in their `permissions`; record `override` on the sale. |
| Receipt numbers | `formatDeviceReceiptNumber(branch.code, device.code, n)` → `MAIN-D1-000042`; `n` is gap-free per device, taken in the same local transaction as the sale. |
| Shifts | **A register's shift is held by the device bound to it** (amendments 3 and 4): the bound device opens and closes it with a cash count; an unbound device sells into the branch's open register shift from the snapshot and never opens, closes or moves cash (`NOT_PRIMARY_DEVICE`). Device shifts are per register: the server never refuses a device shift because the person has a shift open elsewhere (it lists that shift for the managers). Only the opener closes the shift; a manager (`registers.manage`) may force-close it at the till with a note. |
| Cash tenders | Only a bound device takes cash: hide cash methods when `device.registerId` is null; the server refuses a cash tender from an unbound device with `CASH_NOT_ALLOWED`. |
| Refused shift | If the server refuses the `shift_open`, **block selling, cash and refunds at once** (show the code and what to do), keep resending the same record at every sync, and let the cashier discard the shift only when nothing was recorded in it. Never pile up records behind a refused shift. |
| Lock vs. sign-out | "Lock" (button or 5 min idle) keeps the cashier and asks for their PIN only; while the primary holds an open shift, only its opener can sign in. "Log out" only when the device holds no open shift (primary: branch shift closed). |
| Cash movements | Only pay-ins / pay-outs (`other`), **on a bound device only**. Safe drops, float top-ups, bank deposits, expenses and supplier payments stay in the online flows. |
| Amounts typed | Accept Arabic-Indic digits, a comma or `٫` as the decimal separator, spaces and a currency word (`Money.parseInput` in `@arabat/money`). |
| Refunds | Only of sales **this device made**, through `computeRefund`, `paybackAllocation` and `refundApprovalReasons`; when approval is needed, a second person types their PIN (`approval`). |
| Not on devices | Restaurant (tables, kitchen), customers, exchanges, voids, held sales across tills, gateway payments: online only. |

## 5. Sync upload

`POST /device/sync` with `{ "records": [ … ] }`, 1 to 200 records, in **causal order**: a shift's
opening before its sales, cash movements and refunds, a sale before its refunds, the closing last.
Upload as soon as possible after each record; keep a record locally until the server answered
`accepted` or `duplicate` for it.

Answer (always `200` when the token is valid):

```json
{ "serverTime": "…",
  "results": [ { "id": "…", "kind": "sale", "status": "accepted",
                 "result": { "saleId": "…", "receiptNumber": "MAIN-D1-000042" },
                 "code": null, "message": null, "clockSkew": false } ] }
```

| `status` | Meaning | Device action |
|---|---|---|
| `accepted` | Recorded now. | Mark sent. |
| `duplicate` | Already recorded with the same content (a retry). `result` is the stored one. | Mark sent. |
| `refused` | Not recorded; `code` / `message` say why. The server keeps it for the managers. | Keep it, show it as "not accepted". Sending the **same** record again retries it (useful when it arrived before its shift); a fixed record needs a **new id**. A refused `shift_open` is resent at every sync, and selling is blocked meanwhile (§4). A retry with the same answer does not reopen an exception a manager already handled. |

Every record has:

| Field | |
|---|---|
| `kind` | `shift_open`, `sale`, `cash_movement`, `refund`, `shift_close`, `sign_in` |
| `id` | UUIDv7 made by the device. It is the record's id on the server **and** its idempotency key: the same id with the same JSON is a `duplicate`; the same id with different content is refused `IDEMPOTENCY_CONFLICT`. Send the record byte-for-byte the same when retrying. |
| `occurredAt` | Device time when it happened; the server stores it as the business time (shift, sale, refund times, report days) and its own `receivedAt`. More than 10 minutes after the upload, or before its shift opened → accepted with `clockSkew: true` and shown to managers. |
| `membershipId` | Who did it (signed in with their PIN). Must be a member who may use the POS at this branch (`pos.access`), or one deactivated after `occurredAt`; otherwise `MEMBER_NOT_ALLOWED`. |

### `shift_open`

```json
{ "kind": "shift_open", "id": "…", "occurredAt": "…", "membershipId": "…",
  "countedCashMinor": "5000", "note": null }
```

The id becomes the shift id. **Bound devices only** (`NOT_PRIMARY_DEVICE` otherwise); the shift is
the bound register's. The count
is compared with the drawer balance the server holds; a difference is booked to the shift (as in
the browser). Result: `{ shiftId, expectedCashMinor }`. Refusals: `REGISTER_BUSY` (another shift
of this register is open on the server: a manager closes it in `/manager`), `MEMBER_NOT_ALLOWED`.
An open shift the same person left elsewhere (another register, the browser) does **not** refuse
the device shift: it is accepted and the stale shift is listed for the managers
(`shift_left_open`, with a close action).

### `sale`

```json
{ "kind": "sale", "id": "…", "occurredAt": "…", "membershipId": "…", "shiftId": "…",
  "receiptNumber": "MAIN-D1-000042", "catalogVersion": "2026-10-17T07:58:41.902Z",
  "lines": [ { "variantId": "…", "quantity": "2", "listUnitPriceMinor": "250", "unitPriceMinor": "250",
               "priceOverrideReason": null, "discount": { "type": "percent", "value": "10" },
               "grossMinor": "500", "lineDiscountMinor": "50", "orderDiscountMinor": "0", "netMinor": "450" } ],
  "orderDiscount": null,
  "subtotalMinor": "500", "lineDiscountsMinor": "50", "orderDiscountMinor": "0", "totalMinor": "450",
  "payments": [ { "id": "…", "methodId": "…", "amountMinor": "450", "tenderedMinor": "1000",
                  "changeMinor": "550", "feeMinor": "0", "reference": null } ],
  "aboveLimit": false, "zeroTotalReason": null,
  "override": null, "requestRemotePrint": false }
```

- The id becomes the sale id; payment ids are the device's too.
- `discount` / `orderDiscount`: `{ "type": "percent", "value": "10" }` or
  `{ "type": "amount", "value": "0.500" }` (KWD, as in the browser API), or `null`.
- Line and sale figures are what `evaluateSale` returned (`priced`). The server prices the sale
  again from `unitPriceMinor`, `quantity` and the discounts with the same function and refuses any
  difference (`TOTALS_MISMATCH`). It does **not** compare with its own catalog: the device's price
  is final.
- `unitPriceMinor` ≠ `listUnitPriceMinor` is a price change; give `priceOverrideReason`.
- While a product discount is in force, `listUnitPriceMinor` is the discounted price; send the
  price before it as `regularUnitPriceMinor` and the discount as `productDiscountId` (both
  optional, ADR-0133). The server keeps them when they are consistent and the discount is the
  company's, and never refuses a sale because of them.
- Payments: the amounts add up to `totalMinor` (`PAYMENT_TOTAL_MISMATCH` otherwise); cash:
  `tenderedMinor = amountMinor + changeMinor`, `feeMinor = 0`; other methods: `changeMinor = 0`,
  `tenderedMinor` null, `feeMinor` from `checkPayments`. A total of zero has no payments and needs
  `zeroTotalReason`.
- `aboveLimit`: `evaluateSale`'s `aboveLimit`. `override`: `{ approverMembershipId, rights, note }`
  (rights the supervisor lent, from `OVERRIDABLE_PERMISSIONS`); the approver must be another member
  (`OVERRIDE_SELF`, `OVERRIDE_INVALID`).
- `requestRemotePrint: true` only for a device without its own printer: the receipt is then queued
  for the branch's print agents. Otherwise the server never prints device sales.
- Stock: the server books the sale through the stock ledger (recipes expanded). Stock **may go
  negative**; each item driven below zero becomes a manager exception. Never refused for stock.
- `shiftId`: the register shift (the bound device's own, or the branch shift an unbound device
  learned from the snapshot). The sale is booked on that shift's register. A sale for a shift that
  is **already closed** (the device was offline while the drawer was counted) is still accepted,
  booked to that shift and flagged `late` for the managers; its cash reaches the drawer under the
  shift open on it now.
- Cash tenders need a drawer: an unbound device's cash payment is refused `CASH_NOT_ALLOWED`.
- Result: `{ saleId, receiptNumber }`. Refusals: `SHIFT_REQUIRED` (shift not uploaded),
  `WRONG_DEVICE` (a shift of another branch), `RECEIPT_NUMBER_INVALID` (not
  `{branch}-{device code}-NNNNNN` of this device), `RECEIPT_NUMBER_TAKEN`, `UNKNOWN_VARIANT`,
  `CASH_NOT_ALLOWED`,
  `TOTALS_MISMATCH`, `PAYMENT_TOTAL_MISMATCH`, `PAYMENT_METHOD_UNAVAILABLE` (unknown method),
  `PAYMENT_NOT_VERIFIED` (gateway method), `REASON_REQUIRED`, `INVALID_QUANTITY`.

### `cash_movement`

```json
{ "kind": "cash_movement", "id": "…", "occurredAt": "…", "membershipId": "…", "shiftId": "…",
  "direction": "cash_out", "amountMinor": "1500", "note": "Ice" }
```

A pay-in (`cash_in`) or pay-out (`cash_out`) of the drawer, reason "other", **bound devices
only** (`NOT_PRIMARY_DEVICE`). A pay-out above the company limits (`cashOutOtherLimitMinor`,
`cashOutOtherShiftLimitMinor`) is accepted and flagged for review (`result.limitExceeded`).
Result: `{ movementId, limitExceeded }`.

### `refund`

```json
{ "kind": "refund", "id": "…", "occurredAt": "…", "membershipId": "…", "shiftId": "…",
  "saleId": "…", "lines": [ { "position": 0, "quantity": "1", "restock": true } ],
  "reason": "changed_mind", "note": null,
  "payback": [ { "paymentId": "…", "amountMinor": "225", "reference": null } ],
  "approval": { "approverMembershipId": "…", "reasons": ["own_sale"] } }
```

- `saleId` must be a sale **this device** uploaded (`NOT_OWN_SALE` otherwise; `NOT_FOUND` when it
  has not been uploaded yet: retry later). Cash paid back leaves the drawer of the shift's register.
- `lines`: positions of the sale's lines (`computeRefund`); `restock` omitted = by reason
  (damaged / defective stay out of stock). `reason`: `changed_mind`, `defective`, `wrong_item`,
  `damaged`, `price_adjustment`, `other`.
- `payback`: per original payment (`paybackAllocation`); an empty list takes the suggested split.
  Card / transfer pay-backs need `reference` when `requireTenderReference`.
- `approval`: required by `refundApprovalReasons` (`over_limit`, `outside_window`, `own_sale`); the
  approver is another member (`SELF_APPROVAL`). The server records it, it does not decide again.
- Result: `{ refundId, refundNumber, totalMinor }` (`refundNumber` = `{receipt}-R{n}`). Refusals
  also: `REFUND_EXCEEDS_SALE`, `INVALID_QUANTITY`, `REFUND_ALLOCATION_INVALID`,
  `REFERENCE_REQUIRED`, `SETTLEMENT_ACCOUNT_REQUIRED`, `INSUFFICIENT_CASH`.

### `shift_close`

```json
{ "kind": "shift_close", "id": "…", "occurredAt": "…", "membershipId": "…", "shiftId": "…",
  "countedCashMinor": "12500", "note": null, "forced": false }
```

Closes the register's shift against the drawer balance on the server (all of the shift's records
must be uploaded first; the bound device only, except a shift the device opened itself). The person
closing is the one who opened it (`FORBIDDEN` otherwise), **or** a manager present at the till
with `forced: true`: `membershipId` is the manager, who needs `registers.manage` at the branch
(`FORBIDDEN`), and `note` is required (`REASON_REQUIRED`); the close is recorded as forced,
audited `shift.force_closed` and listed for review (`forced_close`). Result:
`{ shiftId, expectedCashMinor, discrepancyMinor, outcome }` (`outcome`: `balanced`, `over`,
`short`). `SHIFT_CLOSED` when a manager already closed it online (the next snapshot's
`branchShift` says so; the device closes its copy).

### `sign_in`

```json
{ "kind": "sign_in", "id": "…", "occurredAt": "…", "membershipId": "…" }
```

A cashier signed in on the device with their PIN. Sets the employee's "last sign-in" (never
backwards) and writes the device audit log (`pos.device_sign_in`, `details.deviceId`).
Result: `{ membershipId }`. Refusal: `MEMBER_NOT_ALLOWED`.

### Refusal codes (all kinds)

`VALIDATION_FAILED` (shape; `message` names the field), `IDEMPOTENCY_CONFLICT`, `WRONG_DEVICE`,
`MEMBER_NOT_ALLOWED`, `SHIFT_REQUIRED`, `SHIFT_CLOSED`, `NOT_PRIMARY_DEVICE` (bound devices only),
`CASH_NOT_ALLOWED`, `FORBIDDEN`, `INTERNAL_ERROR` (retry later), plus the per-kind codes above.

## 6. Example session

```text
POST /device/register {email, password, deviceName}           → select_branch
POST /device/register {email, password, deviceName, merchantId, branchId}
                                                               → registered, token (keychain)
GET  /device/sync                                              → full snapshot, version V1
… offline: Sara signs in with her PIN, opens the shift (S1), sells MAIN-D1-000001 (A1), pays out
  1.500 KWD (C1), refunds part of A1 (F1), closes S1 (X1) …
POST /device/sync {records: [S1, A1, C1, F1, X1]}              → accepted ×5
POST /device/sync {records: [S1, A1, C1, F1, X1]}  (retry)     → duplicate ×5
GET  /device/sync?since=V1                                     → changed products only, version V2
```

## 7. The device web app (`apps/device-web`, bundle at `/device-app/`)

The till itself is this repository's `apps/device-web`, built with relative asset URLs and
published by the API at `GET /device-app/manifest.json` (`Cache-Control: no-cache`):

```json
{ "version": "20261019T002423Z-468f78d179c1", "entry": "index.html",
  "files": [ { "path": "index.html", "sha256": "…", "size": 1234 }, { "path": "assets/…", "sha256": "…", "size": 1 } ] }
```

The native app downloads every file, verifies its SHA-256 and serves the bundle from
`arabat://app/`; unknown paths fall back to `index.html`. The page talks to the server only
through `window.ArabatApp` (bridge version 2; the token stays native) and shows "Open this in the
Arabat app" anywhere else. Its engine is `packages/device-core` (local SQLite schema, snapshot
store, outbox, sync, PIN check, selling / refund / shift logic on `pos-core`); a fake bridge for
tests and development lives in `@arabat/device-core/testing` (sql.js in memory). The device
database keeps every record and the exact JSON it uploaded (`outbox`), retries byte-identical
bodies, and resends a refusal only for `SHIFT_REQUIRED`, `NOT_FOUND`, `INTERNAL_ERROR`,
`SERVICE_UNAVAILABLE` and every refused `shift_open`; other refusals stay in the "not accepted"
list. While the open shift's `shift_open` is refused, the till blocks selling with the code and
guidance (`SHIFT_NOT_ACCEPTED`) and offers "discard this shift" when it has no records.

## 8. What managers see

- `/manager/registers`: the branch's cash drawers with their bound device, current shift and the
  "main register of the branch" flag; "bind to a device" picks one of the branch's unbound tills.
- `/manager/devices`: devices (code, bound drawer, online / last seen / last sync), bind / change
  drawer, the owner's branch move, removal, the browser POS's PIN sign-in link per branch, the
  offline limit
  (`offlineLimitHours`, 1–720, default 72), and the exceptions after uploads with "mark handled"
  and a note: `negative_stock`, `clock_skew`, `refused`, `shift_left_open` (the opener of a device
  shift still had a shift open elsewhere; "close the shift" force-closes it uncounted and marks
  the exception handled), `late` (a record booked to a branch shift after its closing count) and
  `forced_close` (a manager closed an absent cashier's shift at the till). The dashboard checklist
  counts open exceptions.
- Device sign-ins show as the employee's "last sign-in" on `/manager/employees` and in the audit
  log (`pos.device_sign_in`).
- PINs: the manager never sets or sees one (§2a). `/manager/employees/:membershipId` shows when the
  PIN was set and offers only "Clear PIN" (`DELETE /manager/employees/:id/pin`, `employees.manage`)
  for someone who left or whose PIN may have leaked; the person then chooses a new PIN from the till.
