CREATE TABLE "device_exceptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"resolution_note" text,
	CONSTRAINT "device_exceptions_kind_valid" CHECK ("device_exceptions"."kind" in ('negative_stock', 'clock_skew', 'refused')),
	CONSTRAINT "device_exceptions_resolved_consistent" CHECK (("device_exceptions"."resolved_at" is null) = ("device_exceptions"."resolved_by_user_id" is null) or "device_exceptions"."kind" = 'refused')
);
--> statement-breakpoint
CREATE TABLE "device_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"request_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"error_code" text,
	"error_message" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"clock_skew" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "device_records_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "device_records_kind_valid" CHECK ("device_records"."kind" in ('shift_open', 'sale', 'cash_movement', 'refund', 'shift_close')),
	CONSTRAINT "device_records_status_valid" CHECK ("device_records"."status" in ('accepted', 'refused'))
);
--> statement-breakpoint
ALTER TABLE "device_exceptions" ADD CONSTRAINT "device_exceptions_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_exceptions" ADD CONSTRAINT "device_exceptions_merchant_id_device_id_pos_devices_merchant_id_id_fk" FOREIGN KEY ("merchant_id","device_id") REFERENCES "public"."pos_devices"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_records" ADD CONSTRAINT "device_records_merchant_id_device_id_pos_devices_merchant_id_id_fk" FOREIGN KEY ("merchant_id","device_id") REFERENCES "public"."pos_devices"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_exceptions_open_idx" ON "device_exceptions" USING btree ("merchant_id","created_at") WHERE "device_exceptions"."resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "device_exceptions_refused_key" ON "device_exceptions" USING btree ("merchant_id","record_id") WHERE "device_exceptions"."kind" = 'refused';--> statement-breakpoint
CREATE INDEX "device_records_refused_idx" ON "device_records" USING btree ("merchant_id","received_at") WHERE "device_records"."status" = 'refused';--> statement-breakpoint
ALTER TABLE device_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_isolation ON device_records USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
REVOKE DELETE ON device_records FROM app_runtime;
REVOKE UPDATE ON device_records FROM app_runtime;
-- Only a refused record is tried again; an accepted one never changes.
GRANT UPDATE (status, request_hash, payload, result, error_code, error_message, occurred_at, received_at, clock_skew, attempts)
  ON device_records TO app_runtime;
ALTER TABLE device_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_isolation ON device_exceptions USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
REVOKE UPDATE, DELETE ON device_exceptions FROM app_runtime;
GRANT UPDATE (details, resolved_at, resolved_by_user_id, resolution_note) ON device_exceptions TO app_runtime;
