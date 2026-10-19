/**
 * Wipes the transactional data of ONE merchant and keeps its master data (products, staff,
 * roles, branches, settings, payment methods): devices and their registers, shifts, sales,
 * refunds, cash movements and the cash ledger, print jobs, device records / exceptions and
 * stock movements (stock balances go back to zero). Made for the owner's test company before a
 * clean end-to-end test (ADR-0112 amendment 3); never for a live company.
 *
 * Runs as `app_owner` (RLS does not filter the table owner, ADR-0105) with the merchant set in
 * `app.merchant_id` as well, in one transaction. Dry run by default; `--apply` commits.
 *
 *   node apps/api/dist/database/cli/reset-merchant-data.js --merchant=<uuid> [--apply]
 *
 * Connection: DATABASE_OWNER_URL, or DATABASE_ADMIN_URL + APP_OWNER_PASSWORD (Cloud Run job).
 */
import pg from 'pg';
import { hostedRolesFromEnv, withUser } from './hosted-setup.js';

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const merchantId = arg('merchant');
const apply = process.argv.includes('--apply');
if (!merchantId || !/^[0-9a-f-]{36}$/i.test(merchantId))
  throw new Error('Usage: reset-merchant-data --merchant=<uuid> [--apply]');

const url =
  process.env['DATABASE_OWNER_URL'] ??
  (process.env['DATABASE_ADMIN_URL']
    ? withUser(
        process.env['DATABASE_ADMIN_URL'],
        'app_owner',
        hostedRolesFromEnv(process.env).ownerPassword,
      )
    : undefined);
if (!url) throw new Error('DATABASE_OWNER_URL or DATABASE_ADMIN_URL is required');

/** Tables emptied for the merchant, children before parents (foreign keys). */
const TABLES = [
  // Device uploads and print queue
  'device_exceptions',
  'device_records',
  'pin_reset_tokens',
  'print_jobs',
  // Refunds
  'refund_payments',
  'refund_lines',
  'damaged_returns',
  'refunds',
  // Sales
  'receipt_reprints',
  'sale_line_modifiers',
  'sale_lines',
  'payments',
  'pos_cart_events',
  'sales',
  'sale_overrides',
  'order_lines',
  'orders',
  // Cash movements and the cash ledger
  'bank_reconciliation_items',
  'bank_reconciliations',
  'cash_payout_requests',
  'cash_disbursements',
  'cash_transfers',
  'cash_branch_transfers',
  'variance_followups',
  'cash_movements',
  'financial_account_entries',
  // Shifts
  'shifts',
  // Stock movements and documents that only move stock
  'stock_transfer_loss_lines',
  'stock_transfer_losses',
  'stock_transfer_lines',
  'stock_transfers',
  'stock_adjustment_lines',
  'stock_adjustments',
  'stock_reservations',
  'stock_movements',
] as const;

const client = new pg.Client({ connectionString: url });
await client.connect();
const counts: [string, number][] = [];
try {
  await client.query('begin');
  await client.query(`select set_config('app.merchant_id', $1, true)`, [merchantId]);
  await client.query(`select set_config('app.operator_id', gen_random_uuid()::text, true)`);
  const [m] = (
    await client.query(`select display_name_en, display_name_ar from merchants where id = $1`, [
      merchantId,
    ])
  ).rows as { display_name_en: string | null; display_name_ar: string | null }[];
  if (!m) throw new Error(`Merchant ${merchantId} not found.`);
  console.log(`Merchant ${merchantId}: ${m.display_name_ar ?? ''} / ${m.display_name_en ?? ''}`);

  // Financial and inventory records are append-only (triggers refuse deletes, by design). This
  // wipe is the one exception, for a test company: the table owner switches the user triggers
  // off for the transaction and back on before it commits.
  const guarded = [...TABLES, 'pos_devices', 'register_members', 'financial_accounts', 'registers'];
  for (const table of guarded) await client.query(`alter table ${table} disable trigger user`);
  for (const table of TABLES) {
    const r = await client.query(`delete from ${table} where merchant_id = $1`, [merchantId]);
    counts.push([table, r.rowCount ?? 0]);
  }
  // Devices: their registers (never shared with the browser) go with them; register codes are
  // never reused, so the counter stays. Manual registers stay and are counted again.
  const devices = await client.query(
    `select id, register_id from pos_devices where merchant_id = $1`,
    [merchantId],
  );
  const registerIds = (devices.rows as { register_id: string }[]).map((d) => d.register_id);
  counts.push([
    'pos_devices',
    (await client.query(`delete from pos_devices where merchant_id = $1`, [merchantId])).rowCount ??
      0,
  ]);
  if (registerIds.length > 0) {
    await client.query(
      `delete from register_members where merchant_id = $1 and register_id = any($2::uuid[])`,
      [merchantId, registerIds],
    );
    await client.query(
      `delete from financial_accounts where merchant_id = $1 and register_id = any($2::uuid[])`,
      [merchantId, registerIds],
    );
    counts.push([
      'registers (of devices)',
      (
        await client.query(
          `delete from registers where merchant_id = $1 and id = any($2::uuid[])`,
          [merchantId, registerIds],
        )
      ).rowCount ?? 0,
    ]);
  }
  // Everything was deleted: the drawers and treasuries are at zero and uncounted again.
  await client.query(
    `update financial_accounts set counted_at = null where merchant_id = $1 and kind in ('register', 'treasury')`,
    [merchantId],
  );
  await client.query(`update registers set needs_count = true where merchant_id = $1`, [
    merchantId,
  ]);
  counts.push([
    'stock_levels (set to 0)',
    (
      await client.query(
        `update stock_levels set on_hand = 0, avg_cost_minor = null, avg_cost_micro = null, last_movement_at = null, updated_at = now()
         where merchant_id = $1`,
        [merchantId],
      )
    ).rowCount ?? 0,
  ]);
  for (const table of guarded) await client.query(`alter table ${table} enable trigger user`);
  for (const [table, n] of counts) console.log(`${table.padEnd(28)} ${n}`);
  if (apply) {
    await client.query('commit');
    console.log('Committed.');
  } else {
    await client.query('rollback');
    console.log('Dry run: rolled back (add --apply to commit).');
  }
} catch (error) {
  await client.query('rollback').catch(() => {});
  throw error;
} finally {
  await client.end();
}
