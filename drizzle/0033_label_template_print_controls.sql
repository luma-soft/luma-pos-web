ALTER TABLE "label_templates" ADD COLUMN IF NOT EXISTS "show_barcode_text" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "label_templates" ADD COLUMN IF NOT EXISTS "show_store_name" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "label_templates" ADD COLUMN IF NOT EXISTS "barcode_height_mm" numeric(8, 2) DEFAULT '10' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_templates" ADD COLUMN IF NOT EXISTS "barcode_quiet_mm" numeric(8, 2) DEFAULT '2' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_templates" ADD COLUMN IF NOT EXISTS "font_scale" numeric(4, 2) DEFAULT '1' NOT NULL;
