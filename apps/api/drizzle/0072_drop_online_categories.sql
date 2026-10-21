-- ADR-0130: the store categories now live on as collections (copied in 0071).
ALTER TABLE "online_listings" DROP CONSTRAINT "online_listings_online_category_id_online_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "online_listings" DROP COLUMN "online_category_id";
--> statement-breakpoint
DROP TABLE "online_categories";
