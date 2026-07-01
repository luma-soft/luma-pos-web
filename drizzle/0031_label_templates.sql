CREATE TABLE IF NOT EXISTS "label_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "width_mm" numeric(8, 2) DEFAULT '40' NOT NULL,
  "height_mm" numeric(8, 2) DEFAULT '30' NOT NULL,
  "columns" integer DEFAULT 3 NOT NULL,
  "gap_mm" numeric(8, 2) DEFAULT '2' NOT NULL,
  "barcode_type" text DEFAULT 'code128' NOT NULL,
  "show_name" boolean DEFAULT true NOT NULL,
  "show_sku" boolean DEFAULT true NOT NULL,
  "show_price" boolean DEFAULT true NOT NULL,
  "show_unit" boolean DEFAULT false NOT NULL,
  "show_barcode_text" boolean DEFAULT true NOT NULL,
  "show_store_name" boolean DEFAULT false NOT NULL,
  "barcode_height_mm" numeric(8, 2) DEFAULT '10' NOT NULL,
  "barcode_quiet_mm" numeric(8, 2) DEFAULT '2' NOT NULL,
  "font_scale" numeric(4, 2) DEFAULT '1' NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "label_templates_active_idx" ON "label_templates" ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "label_templates_default_idx"
ON "label_templates" ("is_default")
WHERE "is_default" = true AND "is_active" = true;--> statement-breakpoint
INSERT INTO "label_templates" (
  "name",
  "width_mm",
  "height_mm",
  "columns",
  "gap_mm",
  "barcode_type",
  "show_name",
  "show_sku",
  "show_price",
  "show_unit",
  "show_barcode_text",
  "show_store_name",
  "barcode_height_mm",
  "barcode_quiet_mm",
  "font_scale",
  "is_default",
  "is_active",
  "sort_order"
)
SELECT *
FROM (VALUES
  ('Tem 40x30mm', 40::numeric, 30::numeric, 3, 2::numeric, 'code128', true, true, true, false, true, false, 10::numeric, 2::numeric, 1::numeric, true, true, 0),
  ('Tem 50x30mm', 50::numeric, 30::numeric, 2, 3::numeric, 'code128', true, true, true, false, true, false, 11::numeric, 2::numeric, 1::numeric, false, true, 10),
  ('Tem nhỏ 35x22mm', 35::numeric, 22::numeric, 4, 2::numeric, 'code128', true, true, false, false, true, false, 8::numeric, 1.5::numeric, 0.9::numeric, false, true, 20)
) AS defaults(
  "name",
  "width_mm",
  "height_mm",
  "columns",
  "gap_mm",
  "barcode_type",
  "show_name",
  "show_sku",
  "show_price",
  "show_unit",
  "show_barcode_text",
  "show_store_name",
  "barcode_height_mm",
  "barcode_quiet_mm",
  "font_scale",
  "is_default",
  "is_active",
  "sort_order"
)
WHERE NOT EXISTS (SELECT 1 FROM "label_templates");
