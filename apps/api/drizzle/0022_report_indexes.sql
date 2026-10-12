CREATE INDEX "purchase_receipts_branch_time_idx" ON "purchase_receipts" USING btree ("merchant_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "refund_payments_time_idx" ON "refund_payments" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "refunds_completed_idx" ON "refunds" USING btree ("merchant_id","branch_id","completed_at") WHERE "refunds"."status" = 'completed';--> statement-breakpoint
CREATE INDEX "cash_movements_branch_time_idx" ON "cash_movements" USING btree ("merchant_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "shifts_branch_closed_idx" ON "shifts" USING btree ("merchant_id","branch_id","closed_at");--> statement-breakpoint
CREATE INDEX "payments_branch_time_idx" ON "payments" USING btree ("merchant_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_transfers_dispatched_idx" ON "stock_transfers" USING btree ("merchant_id","dispatched_at");