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
                 "branchCode": "MAIN", "registerId": "…", "registerCode": "R2" },
     "token": "q3V…43 chars" }
   ```

The device **is** a new register of that branch (`registerCode` `R1`, `R2`, … from a counter that
only grows; codes are never reused, even after removal). Errors: `401` `INVALID_CREDENTIALS`,
`403` `ACCOUNT_DISABLED`, `403` `FORBIDDEN` (no `registers.manage` there), `409`
`PLAN_LIMIT_REACHED` (the company's plan allows no more registers), `404` (inactive branch).

`GET /device/me` → the `device` object above. Use it to check the token.

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
  "device":   { "id": "…", "name": "Front till", "merchantId": "…", "branchId": "…", "branchCode": "MAIN", "registerId": "…", "registerCode": "R2" },
  "merchant": { "id": "…", "nameEn": "Arabat Café", "nameAr": "مقهى عربات", "currency": "KWD", "timezone": "Asia/Kuwait" },
  "branch":   { "id": "…", "code": "MAIN", "nameEn": "Main", "nameAr": "الرئيسي", "phone": null, "address": null, "receiptHeader": null, "receiptFooter": "Thank you" },
  "register": { "id": "…", "code": "R2", "defaultOpeningFloatMinor": "0", "discrepancyToleranceMinor": "0" },
  "settings": {
    "maxDiscountPercent": "10", "priceOverrideFloorPercent": "50", "priceOverrideCeilingPercent": "200",
    "priceOverrideBelowCost": false, "requireTenderReference": true, "blindCashCount": true,
    "cashOutOtherLimitMinor": "20000", "cashOutOtherShiftLimitMinor": "50000",
    "refundWindowDays": 30, "refundApprovalLimitMinor": "20000", "refundOwnSalesNeedApproval": true,
    "allowNegativeStock": false, "heldSaleExpiryHours": 24
  },
  "counters": { "lastReceiptNumber": "MAIN-R2-000041" },
  "paymentMethods": [ { "id": "…", "kind": "cash", "status": "active", "availableInPos": true, "gatewayProvider": null,
                        "financialAccountId": null, "nameEn": "Cash", "nameAr": "نقدي", "feeType": "none",
                        "feeFixedMinor": "0", "feePercent": "0", "sortOrder": 0 } ],
  "staff": [ { "membershipId": "…", "userId": "…", "fullName": "Sara", "isOwner": false,
               "pinHash": "$argon2id$v=19$m=65536,t=3,p=1$…", "permissions": ["pos.access", "sales.create", "…"] } ],
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
- `sellable: false`: archived, or no longer sold at this branch. Hide it from selling; keep it for
  old receipts. A variant with `status: "archived"` is not sold either.
- `catalogVersion`: record it on every sale priced with this catalog (§5).
- `staff`: active people who may use the POS at this branch, with every permission they hold
  **at this branch** (keys of `@arabat/permissions`; check rights with `permissions.includes(key)`).
  People without a PIN (`pinHash: null`) cannot sign in on devices. Someone missing from the list
  (removed, deactivated, moved) must be signed out.
- `counters.lastReceiptNumber`: the highest receipt number of this register the server has. After
  restoring a device from scratch with the same token, continue above it.
- Payment methods: offer those with `status: "active"`, `availableInPos: true` and no
  `gatewayProvider` (gateway payments are online only).
- Not in the snapshot: product images, customers, modifiers and recipes (restaurant only, online
  only; recipes are expanded by the server when it ingests a sale), held sales of other tills.

## 4. Rules the device applies

| Topic | Rule |
|---|---|
| Offline limit | Count hours since the last **successful** sync (download or upload). Yellow warning after 24 h, red after 48 h, **stop selling** at `offlineLimitHours` until a sync succeeds. |
| PIN | Verify with argon2id against `pinHash` (PHC string: 64 MiB, 3 passes, 1 lane). 5 wrong PINs lock that person on that device for 5 minutes, doubling on repeat. Never upload or display the hash. |
| Selling | Price and check every sale with `@arabat/pos-core` and the downloaded `settings` / `staff[].permissions`, in the order in `packages/pos-core/README.md` (rights, `evaluateSale`, `checkPayments`). Pass `expectedTotalMinor: null`. |
| Supervisor | When `requiredSaleRights` lists rights the cashier lacks, a supervisor types **their own PIN**; check the right in their `permissions`; record `override` on the sale. |
| Receipt numbers | `formatDeviceReceiptNumber(branch.code, register.code, n)` → `MAIN-R2-000042`; `n` is gap-free per device, taken in the same local transaction as the sale. |
| Shifts | One open shift on the device at a time. A person can hold only one open shift anywhere (browser or device). |
| Cash movements | Only pay-ins / pay-outs (`other`). Safe drops, float top-ups, bank deposits, expenses and supplier payments stay in the online flows. |
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
                 "result": { "saleId": "…", "receiptNumber": "MAIN-R2-000042" },
                 "code": null, "message": null, "clockSkew": false } ] }
```

| `status` | Meaning | Device action |
|---|---|---|
| `accepted` | Recorded now. | Mark sent. |
| `duplicate` | Already recorded with the same content (a retry). `result` is the stored one. | Mark sent. |
| `refused` | Not recorded; `code` / `message` say why. The server keeps it for the managers. | Keep it, show it as "not accepted". Sending the **same** record again retries it (useful when it arrived before its shift); a fixed record needs a **new id**. |

Every record has:

| Field | |
|---|---|
| `kind` | `shift_open`, `sale`, `cash_movement`, `refund`, `shift_close` |
| `id` | UUIDv7 made by the device. It is the record's id on the server **and** its idempotency key: the same id with the same JSON is a `duplicate`; the same id with different content is refused `IDEMPOTENCY_CONFLICT`. Send the record byte-for-byte the same when retrying. |
| `occurredAt` | Device time when it happened; the server stores it as the business time (shift, sale, refund times, report days) and its own `receivedAt`. More than 10 minutes after the upload, or before its shift opened → accepted with `clockSkew: true` and shown to managers. |
| `membershipId` | Who did it (signed in with their PIN). Must be a member who may use the POS at this branch (`pos.access`), or one deactivated after `occurredAt`; otherwise `MEMBER_NOT_ALLOWED`. |

### `shift_open`

```json
{ "kind": "shift_open", "id": "…", "occurredAt": "…", "membershipId": "…",
  "countedCashMinor": "5000", "note": null }
```

The id becomes the shift id. The count is compared with the drawer balance the server holds; a
difference is booked to the shift (as in the browser). Result: `{ shiftId, expectedCashMinor }`.
Refusals: `REGISTER_BUSY` (another shift of this register is open on the server),
`SHIFT_ALREADY_OPEN` (this person has an open shift elsewhere).

### `sale`

```json
{ "kind": "sale", "id": "…", "occurredAt": "…", "membershipId": "…", "shiftId": "…",
  "receiptNumber": "MAIN-R2-000042", "catalogVersion": "2026-10-17T07:58:41.902Z",
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
- Result: `{ saleId, receiptNumber }`. Refusals: `SHIFT_REQUIRED` (shift not uploaded),
  `SHIFT_CLOSED`, `WRONG_DEVICE` (shift of another register), `RECEIPT_NUMBER_INVALID` (not
  `{branch}-{register}-NNNNNN` of this device), `RECEIPT_NUMBER_TAKEN`, `UNKNOWN_VARIANT`,
  `TOTALS_MISMATCH`, `PAYMENT_TOTAL_MISMATCH`, `PAYMENT_METHOD_UNAVAILABLE` (unknown method),
  `PAYMENT_NOT_VERIFIED` (gateway method), `REASON_REQUIRED`, `INVALID_QUANTITY`.

### `cash_movement`

```json
{ "kind": "cash_movement", "id": "…", "occurredAt": "…", "membershipId": "…", "shiftId": "…",
  "direction": "cash_out", "amountMinor": "1500", "note": "Ice" }
```

A pay-in (`cash_in`) or pay-out (`cash_out`) of the drawer, reason "other". A pay-out above the
company limits (`cashOutOtherLimitMinor`, `cashOutOtherShiftLimitMinor`) is accepted and flagged for
review (`result.limitExceeded`). Result: `{ movementId, limitExceeded }`.

### `refund`

```json
{ "kind": "refund", "id": "…", "occurredAt": "…", "membershipId": "…", "shiftId": "…",
  "saleId": "…", "lines": [ { "position": 0, "quantity": "1", "restock": true } ],
  "reason": "changed_mind", "note": null,
  "payback": [ { "paymentId": "…", "amountMinor": "225", "reference": null } ],
  "approval": { "approverMembershipId": "…", "reasons": ["own_sale"] } }
```

- `saleId` must be a sale **this device** uploaded (`NOT_OWN_SALE` otherwise; `NOT_FOUND` when it
  has not been uploaded yet: retry later).
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
  "countedCashMinor": "12500", "note": null }
```

Closes the shift against the drawer balance on the server (all of the shift's records must be
uploaded first). Result: `{ shiftId, expectedCashMinor, discrepancyMinor, outcome }` (`outcome`:
`balanced`, `over`, `short`).

### Refusal codes (all kinds)

`VALIDATION_FAILED` (shape; `message` names the field), `IDEMPOTENCY_CONFLICT`, `WRONG_DEVICE`,
`MEMBER_NOT_ALLOWED`, `SHIFT_REQUIRED`, `SHIFT_CLOSED`, `INTERNAL_ERROR` (retry later), plus the
per-kind codes above.

## 6. Example session

```text
POST /device/register {email, password, deviceName}           → select_branch
POST /device/register {email, password, deviceName, merchantId, branchId}
                                                               → registered, token (keychain)
GET  /device/sync                                              → full snapshot, version V1
… offline: Sara signs in with her PIN, opens the shift (S1), sells MAIN-R2-000001 (A1), pays out
  1.500 KWD (C1), refunds part of A1 (F1), closes S1 (X1) …
POST /device/sync {records: [S1, A1, C1, F1, X1]}              → accepted ×5
POST /device/sync {records: [S1, A1, C1, F1, X1]}  (retry)     → duplicate ×5
GET  /device/sync?since=V1                                     → changed products only, version V2
```

## 7. What managers see

- `/manager/devices`: devices (online / last seen / last sync), removal, the offline limit
  (`offlineLimitHours`, 1–720, default 72), and the exceptions after uploads (negative stock,
  device clock, not accepted) with "mark handled" and a note. The dashboard checklist counts open
  exceptions.
- PINs: `/manager/employees/:membershipId` → "Device PIN" (6–12 digits, not all the
  same digit, not a straight run). Setting another person's PIN follows the same authority rules as
  any other change to that employee.
