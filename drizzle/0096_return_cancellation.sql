ALTER TABLE "returns" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'completed';
--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN IF NOT EXISTS "cancelled_by" uuid REFERENCES "profiles"("id");
--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "returns_status_created_idx" ON "returns" ("status", "created_at");
