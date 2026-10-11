CREATE TABLE "currencies" (
	"code" char(3) PRIMARY KEY NOT NULL,
	"exponent" smallint NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	CONSTRAINT "currencies_code_format" CHECK ("currencies"."code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "currencies_exponent_range" CHECK ("currencies"."exponent" between 0 and 4)
);
--> statement-breakpoint
-- Reference data: the API may read but never modify it (seeds run as app_owner).
REVOKE INSERT, UPDATE, DELETE ON "currencies" FROM app_runtime;
