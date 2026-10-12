import pg from 'pg';
import { runMigrations } from '../database/migrate.js';
import { SEEDS } from '../database/seeds/index.js';
import { runSeeds } from '../database/seeds/run-seeds.js';
import { integrationDatabaseUrls } from './integration-env.js';

const IDENTITY_TABLES = [
  'audit_log',
  'payment_events',
  'online_payments',
  'stock_reservations',
  'online_order_lines',
  'online_orders',
  'online_listings',
  'online_stores',
  'kitchen_tickets',
  'restaurant_order_item_modifiers',
  'restaurant_order_items',
  'restaurant_orders',
  'recipe_components',
  'product_modifier_groups',
  'modifiers',
  'modifier_groups',
  'kitchen_station_categories',
  'kitchen_stations',
  'dining_tables',
  'dining_areas',
  'restaurant_settings',
  'sale_line_modifiers',
  'customer_notes',
  'stock_transfer_lines',
  'stock_transfers',
  'purchase_receipt_lines',
  'purchase_receipts',
  'purchase_order_lines',
  'purchase_orders',
  'suppliers',
  'document_sequences',
  'refund_payments',
  'refund_lines',
  'refunds',
  'payments',
  'sale_lines',
  'sales',
  'order_lines',
  'orders',
  'customers',
  'receipt_sequences',
  'sales_settings',
  'cash_movements',
  'shifts',
  'register_members',
  'registers',
  'payment_methods',
  'financial_account_entries',
  'financial_accounts',
  'stock_movements',
  'stock_adjustment_lines',
  'stock_adjustments',
  'stock_levels',
  'inventory_settings',
  'product_images',
  'product_branch_availability',
  'product_barcodes',
  'product_variants',
  'products',
  'categories',
  'invitation_assignments',
  'invitations',
  'sessions',
  'auth_tickets',
  'password_reset_tokens',
  'rate_limit_buckets',
  'role_assignments',
  'role_permissions',
  'roles',
  'memberships',
  'branches',
  'merchants',
  'users',
  'platform_operators',
];

/** Migrates the test database and empties identity tables (reference data stays). */
export async function prepareIntegrationDatabase(): Promise<{
  owner: pg.Pool;
  runtimeUrl: string;
}> {
  const { runtimeUrl, ownerUrl } = integrationDatabaseUrls();
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 3 });
  await runMigrations(owner);
  await runSeeds(owner, 'test', SEEDS);
  await owner.query(`truncate ${IDENTITY_TABLES.join(', ')} cascade`);
  return { owner, runtimeUrl };
}
