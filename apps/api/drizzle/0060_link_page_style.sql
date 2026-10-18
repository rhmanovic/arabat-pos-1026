ALTER TABLE "link_pages" DROP CONSTRAINT "link_pages_background_valid";--> statement-breakpoint
ALTER TABLE "link_page_items" ADD COLUMN "emoji" text;--> statement-breakpoint
ALTER TABLE "link_page_items" ADD COLUMN "effect" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "link_pages" ADD COLUMN "background_color" text;--> statement-breakpoint
ALTER TABLE "link_pages" ADD COLUMN "background_color2" text;--> statement-breakpoint
ALTER TABLE "link_pages" ADD COLUMN "text_color" text;--> statement-breakpoint
ALTER TABLE "link_pages" ADD COLUMN "button_text_color" text;--> statement-breakpoint
ALTER TABLE "link_pages" ADD COLUMN "button_variant" text DEFAULT 'fill' NOT NULL;--> statement-breakpoint
ALTER TABLE "link_pages" ADD COLUMN "font" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "link_pages" ADD COLUMN "animation" text DEFAULT 'fade-up' NOT NULL;--> statement-breakpoint
ALTER TABLE "link_page_items" ADD CONSTRAINT "link_page_items_emoji_valid" CHECK ("link_page_items"."emoji" is null or length("link_page_items"."emoji") between 1 and 16);--> statement-breakpoint
ALTER TABLE "link_page_items" ADD CONSTRAINT "link_page_items_effect_valid" CHECK ("link_page_items"."effect" in ('none', 'pulse', 'shake', 'glow'));--> statement-breakpoint
ALTER TABLE "link_pages" ADD CONSTRAINT "link_pages_colors_valid" CHECK (coalesce("link_pages"."background_color", '#000000') ~ '^#[0-9a-fA-F]{6}$' and coalesce("link_pages"."background_color2", '#000000') ~ '^#[0-9a-fA-F]{6}$' and coalesce("link_pages"."text_color", '#000000') ~ '^#[0-9a-fA-F]{6}$' and coalesce("link_pages"."button_text_color", '#000000') ~ '^#[0-9a-fA-F]{6}$');--> statement-breakpoint
ALTER TABLE "link_pages" ADD CONSTRAINT "link_pages_background_colors" CHECK (("link_pages"."background" <> 'custom' or "link_pages"."background_color" is not null) and ("link_pages"."background" <> 'gradient' or ("link_pages"."background_color" is not null and "link_pages"."background_color2" is not null)));--> statement-breakpoint
ALTER TABLE "link_pages" ADD CONSTRAINT "link_pages_variant_valid" CHECK ("link_pages"."button_variant" in ('fill', 'outline', 'soft', 'shadow'));--> statement-breakpoint
ALTER TABLE "link_pages" ADD CONSTRAINT "link_pages_font_valid" CHECK ("link_pages"."font" in ('default', 'cairo', 'tajawal', 'almarai', 'changa', 'el-messiri', 'amiri', 'reem-kufi'));--> statement-breakpoint
ALTER TABLE "link_pages" ADD CONSTRAINT "link_pages_animation_valid" CHECK ("link_pages"."animation" in ('none', 'fade-up', 'pop', 'slide'));--> statement-breakpoint
ALTER TABLE "link_pages" ADD CONSTRAINT "link_pages_background_valid" CHECK ("link_pages"."background" in ('light', 'dark', 'brand', 'custom', 'gradient'));