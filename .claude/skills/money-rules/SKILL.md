---
name: money-rules
description: Rules and API for monetary values (KWD 3 decimals, bigint fils, half-up rounding, decimal-string JSON, micro-precision average cost). Use whenever code, a migration, a contract or a UI touches a price, cost, discount, fee, total, payment, refund, cash amount, stock value or any `*_minor` / `*_micro` column.
---

# Money rules

Sources: `packages/money/src/*`, ADR-0005, ADR-0012, ADR-0099 (`docs/DECISIONS.md`),
BR-030..035, BR-071, BR-080/081, BR-174, BR-183 (`docs/BUSINESS_RULES.md`), `docs/DATABASE.md` §4.

## 1. Hard rules
- KWD, 3 decimals, 1 KWD = 1000 fils (BR-030; `CURRENCIES` in `packages/money/src/currency.ts`).
- Amounts are `bigint` minor units, end to end (BR-032, ADR-0005). Never `number`, `parseFloat`,
  `Number(amount)`, `Math.round`, `toFixed` or `Intl.NumberFormat` on money (BR-031). Leaving
  bigint is acceptable only for non-money output, e.g. the whole-percent badge `savedPercent`
  (`packages/pos-core/src/discounts.ts`).
- Rounding happens only where you ask for it, always **half away from zero** with
  `divideHalfUp` (`packages/money/src/decimal.ts`, BR-033). Do not write your own `/` on bigint
  for money: bigint division truncates.
- User input is never rounded: `Money.parse` throws on more than 3 decimals (`money.ts`).
- One currency per sale; `add`/`subtract`/`compare` throw `MoneyError` on mixed currencies.
- Financial records are append-only; a correction is a new record (BR-034, ADR-0008).
- After editing `packages/money` run `pnpm build:packages`: the API reads `dist/` (CLAUDE.md §9).

## 2. Money API (`@arabat/money`, exports in `packages/money/src/index.ts`)
```ts
import { Money, sumMoney, divideHalfUp, parseQuantity, quantityValue } from '@arabat/money';
const p = Money.parse('1.250', 'KWD');          // p.minor === 1250n
Money.parseInput('٠٫٢٥٠ د.ك', 'KWD');           // Arabic digits/comma/currency word → 250n
Money.ofMinor(1250n, 'KWD');                     // from a DB column
p.add(Money.parse('0.750', 'KWD'));              // 2.000
p.multiply('1.500');                             // × decimal qty, half-up → 1.875
p.percentage('12.5');                            // 12.5 %, half-up → 0.156
Money.parse('1.000', 'KWD').allocate([1n, 1n, 1n]); // 0.334, 0.333, 0.333 (largest remainder)
sumMoney([a, b], 'KWD');
p.toDecimalString();                             // "1.250" (always 3 digits)
p.toJSON();                                      // { amount: "1.250", currency: "KWD" }
Money.fromJSON({ amount: '1.250', currency: 'KWD' });
quantityValue(parseQuantity('0.250'), 1250n);    // value of 0.250 units at 1.250 → 313n
```
- Quantities are bigint thousandths (`quantity.ts`: `parseQuantity`, `formatQuantity`); price ×
  quantity is `divideHalfUp(price * qtyMilli, 1000n)`.
- Percent checks without rounding: `exceedsDiscountLimit`, `belowPercentOf`, `abovePercentOf`
  (`pricing.ts`) compare cross-multiplied bigints; use them for limits, never a rounded percent.
- Payment fees: `processingFee` (`fees.ts`, BR-071): fixed + percent half-up, capped at the amount.

## 3. Where rounding happens (order matters)
Cart pricing is `priceCart` (`packages/money/src/pricing.ts`, BR-080), used by the tills and by
the API through `packages/pos-core` (`evaluateSale` in `sale.ts`, called via `rules()` in
`apps/api/src/kernel/errors/pos-rule.ts`; see the `device-app` skill). Do not re-implement it.
1. line gross = half-up(unit price × qty) per line;
2. line discount = half-up percent of the gross, or an amount ≤ gross;
3. sale discount on Σ(gross − line discount): half-up percent or amount ≤ base, then
   `allocate`d to lines by their base (no fils lost or created);
4. line net = gross − both discounts; total = Σ line net (round per line, then sum: BR-033).
- D4 combined limit (BR-081/BR-183): `isAboveLimit` in `packages/pos-core/src/sale.ts` compares
  line discount + sale-discount share + gap under the list gross with the list gross, against
  `sales_settings.max_discount_percent`. Any new discount source must be added to that sum.
- Product discounts: `discountedPrice` (`packages/pos-core/src/discounts.ts`) half-up; never
  changes catalog prices; price in force via `offersFor`/`inForce`
  (`apps/api/src/modules/catalog/discount-offers.ts`) and `offerAt` (ADR-0133; `online-store` skill).
- Online promotions: `apps/api/src/modules/ecommerce/promotions.service.ts` (percent half-up,
  capped at the scoped lines, total kept above zero).
- Tax: not implemented (OQ-002, M12); there is no cash rounding (OQ-003). When tax is added it
  is half-up per line then summed (BR-033) and needs an ADR (`new-adr` skill).

## 4. Moving average in micro units (ADR-0099, BR-174)
- `stock_levels.avg_cost_micro` / `stock_movements.avg_cost_micro_after` = 10⁻⁶ KWD per unit
  (fils × 1000, `MICRO_PER_MINOR`); `avg_cost_minor` is display/fallback only.
- Compute with `weightedAverageCostMicro`, value movements with `quantityValueMicro`, display
  with `microToMinor` (`packages/money/src/quantity.ts`). Never derive cost from `avg_cost_minor`.
- Only `StockLedgerService.apply` (`apps/api/src/modules/inventory/stock-ledger.service.ts`)
  changes balances and averages; sum its `AppliedLine.valueMinor`, do not re-round values.
- Negative balances keep their cost basis; rounding of averages is shown as its own
  roll-forward line, never hidden.

## 5. Database
- Columns: `bigint`, suffix `_minor` (fils) or `_micro`, plus `currency char(3)` default `'KWD'`
  where the row is a document (DATABASE.md §4). Drizzle: `bigint({ mode: 'bigint' })`
  (e.g. `catalog.schema.ts`). Forbidden: `real`, `double precision`, `money`, `numeric` for money.
- Quantities `numeric(14, 3)`; percentages such as `max_discount_percent` `numeric(5, 2)`;
  read them as strings, never as numbers.
- Raw SQL rows return bigint as strings: `BigInt(r['amount_minor'] as string)`.
- New money columns: follow the `new-migration` skill.

## 6. JSON / contracts (ADR-0005, ADR-0012)
- Responses carry `MoneyJson` `{ amount: "1.250", currency: "KWD" }` (`moneySchema` in
  `packages/contracts/src/catalog.ts`); services build it with `Money.ofMinor(minor, CURRENCY).toJSON()`.
- Requests take decimal strings: `moneyAmountSchema` (≥ 0) in `catalog.ts`, `signedAmountSchema`
  in `cash.ts`, both ≤ 3 decimals. The device API sends minor units as digit strings
  (`amountMinor` in `devices.ts`). Never a JSON number for money.
- `Number(...) > 0` in `.refine` (contracts `discounts.ts`, `ecommerce.ts`) is a sign check only;
  do not copy the pattern into arithmetic.

## 7. UI formatting (ar / en)
- Display only with `formatMoney(money, language)` (`packages/i18n/src/format.ts`): string
  grouping, Latin digits (OQ-012), `KWD 1,234.500` in English, `1,234.500 د.ك` in Arabic.
- Parse what people type with `Money.parseInput` / `normalizeAmountInput` (`input.ts`).
- Keep the till's displayed total from the same `priceCart`/pos-core code the server uses
  (ADR-0013); the server is authoritative.

## 8. Tests expected (TESTING.md §3.1; `run-tests` skill)
Unit tests next to the code (`packages/money/src/*.test.ts`, `packages/pos-core/src/pos-core.test.ts`,
`packages/i18n/src/i18n.test.ts`); integration for sales limits in
`apps/api/src/modules/sales/sales-controls.int.test.ts`. Cover:
- half-up at .5 for both signs (`divideHalfUp(-5n, 2n) === -3n`) and just below .5;
- more than 3 decimals refused, malformed input, Arabic-digit input;
- amounts beyond `Number.MAX_SAFE_INTEGER` round-trip through JSON;
- `0.1 + 0.2`-style sums exact; currency mismatch throws;
- allocation sums to the total (random inputs), zero/negative weights refused;
- discount equal to the line, over the line, 100 %, stacked line + sale discount over the D4 limit;
- fractional quantities (`0.001`, `1.250`), zero price, fee above the amount;
- micro average: grams at sub-fils cost, receipt into a negative balance, no prior cost.
`packages/money` targets ~100 % branch coverage (TESTING.md).
