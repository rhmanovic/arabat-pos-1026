ALTER TABLE "pos_devices" DROP CONSTRAINT "pos_devices_role_valid";--> statement-breakpoint
DROP INDEX "pos_devices_one_primary_per_branch";--> statement-breakpoint
DROP INDEX "pos_devices_register_key";--> statement-breakpoint
ALTER TABLE "pos_devices" ALTER COLUMN "register_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_devices" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "registers" ADD COLUMN "is_main" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_devices_branch_code_key" ON "pos_devices" USING btree ("merchant_id","branch_id",lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "registers_one_main_per_branch" ON "registers" USING btree ("merchant_id","branch_id") WHERE "registers"."is_main";--> statement-breakpoint
CREATE UNIQUE INDEX "pos_devices_register_key" ON "pos_devices" USING btree ("register_id") WHERE "pos_devices"."register_id" is not null;--> statement-breakpoint
ALTER TABLE "pos_devices" DROP COLUMN "role";
--> statement-breakpoint
-- ADR-0112 amendment 4: a register is a physical cash drawer, a device is a selling device.
-- Every device gets a permanent code in its branch (D1, D2, … in registration order; the
-- counter table now numbers devices), its receipt series from now on.
WITH numbered AS (
  SELECT id, 'D' || row_number() OVER (PARTITION BY merchant_id, branch_id ORDER BY created_at, id) AS code
  FROM pos_devices)
UPDATE pos_devices d SET code = n.code FROM numbered n WHERE n.id = d.id;
--> statement-breakpoint
ALTER TABLE "pos_devices" ALTER COLUMN "code" SET NOT NULL;
--> statement-breakpoint
DELETE FROM register_code_sequences;
--> statement-breakpoint
INSERT INTO register_code_sequences (merchant_id, branch_id, last_number)
SELECT merchant_id, branch_id, count(*) FROM pos_devices GROUP BY merchant_id, branch_id;
--> statement-breakpoint
-- Registers that device registrations created are no longer the device's: those with no history
-- go away (with their drawer account), the others stay as plain, unbound registers.
CREATE TEMP TABLE device_registers_to_drop AS
  SELECT r.id FROM registers r
  WHERE EXISTS (SELECT 1 FROM pos_devices d WHERE d.register_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM shifts s WHERE s.register_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM sales x WHERE x.register_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.register_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM cash_movements m WHERE m.register_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM refunds f WHERE f.register_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM financial_accounts a JOIN financial_account_entries e ON e.account_id = a.id
                    WHERE a.register_id = r.id);
--> statement-breakpoint
UPDATE pos_devices SET register_id = NULL;
--> statement-breakpoint
DELETE FROM register_members WHERE register_id IN (SELECT id FROM device_registers_to_drop);
--> statement-breakpoint
DELETE FROM financial_accounts WHERE register_id IN (SELECT id FROM device_registers_to_drop);
--> statement-breakpoint
DELETE FROM registers WHERE id IN (SELECT id FROM device_registers_to_drop);
--> statement-breakpoint
DROP TABLE device_registers_to_drop;
--> statement-breakpoint
-- The device's identity: its code and the register it is bound to (null = unbound).
DROP FUNCTION device_authenticate(bytea);
--> statement-breakpoint
CREATE FUNCTION device_authenticate(p_token_hash bytea)
RETURNS TABLE (id uuid, merchant_id uuid, branch_id uuid, register_id uuid, revoked boolean, code text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE pos_devices d SET last_seen_at = CASE WHEN d.revoked_at IS NULL THEN now() ELSE d.last_seen_at END
  WHERE d.token_hash = p_token_hash
  RETURNING d.id, d.merchant_id, d.branch_id, d.register_id, d.revoked_at IS NOT NULL, d.code
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION device_authenticate(bytea) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION device_authenticate(bytea) TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (branch_id, register_id, branch_changed_at, code) ON pos_devices TO app_runtime;
