ALTER TABLE "kitchen_ticket_items" ADD COLUMN IF NOT EXISTS "course" text DEFAULT 'asap' NOT NULL;
--> statement-breakpoint
ALTER TABLE "kitchen_ticket_items" ADD COLUMN IF NOT EXISTS "fire_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kitchen_ticket_items_fire_at_idx" ON "kitchen_ticket_items" USING btree ("fire_at","status");
