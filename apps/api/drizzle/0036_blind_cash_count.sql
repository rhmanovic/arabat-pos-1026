-- Remediation R1.5 (BR-162, FND-401): blind cash counts, on by default per company.
ALTER TABLE "sales_settings" ADD COLUMN "blind_cash_count" boolean DEFAULT true NOT NULL;