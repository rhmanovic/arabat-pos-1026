ALTER TABLE "device_exceptions" DROP CONSTRAINT "device_exceptions_kind_valid";--> statement-breakpoint
ALTER TABLE "device_records" DROP CONSTRAINT "device_records_kind_valid";--> statement-breakpoint
DROP INDEX "shifts_one_open_per_member";--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "device_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_one_open_per_member" ON "shifts" USING btree ("membership_id") WHERE "shifts"."status" = 'open' and "shifts"."device_id" is null;--> statement-breakpoint
ALTER TABLE "device_exceptions" ADD CONSTRAINT "device_exceptions_kind_valid" CHECK ("device_exceptions"."kind" in ('negative_stock', 'clock_skew', 'refused', 'shift_left_open', 'late', 'forced_close'));--> statement-breakpoint
ALTER TABLE "device_records" ADD CONSTRAINT "device_records_kind_valid" CHECK ("device_records"."kind" in ('shift_open', 'sale', 'cash_movement', 'refund', 'shift_close', 'sign_in'));
--> statement-breakpoint
-- ADR-0112 amendment 3: a shift opened on a local-first device belongs to that device (its
-- register); existing device shifts, closed ones included, are attributed to the device that
-- owns the register. Closed shifts are immutable by trigger; this attribution is the one
-- exception, done by the table owner with the trigger off inside the migration's transaction.
ALTER TABLE shifts DISABLE TRIGGER shifts_closed_is_final;
--> statement-breakpoint
UPDATE shifts s SET device_id = d.id FROM pos_devices d
WHERE d.register_id = s.register_id AND s.device_id IS NULL;
--> statement-breakpoint
ALTER TABLE shifts ENABLE TRIGGER shifts_closed_is_final;
