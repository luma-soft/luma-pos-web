ALTER TABLE "mobile_push_devices" ADD COLUMN IF NOT EXISTS "effective_user_id" uuid;--> statement-breakpoint
UPDATE "mobile_push_devices"
SET "effective_user_id" = "user_id"
WHERE "effective_user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "mobile_push_devices" ALTER COLUMN "effective_user_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mobile_push_devices" ADD CONSTRAINT "mobile_push_devices_effective_user_id_profiles_id_fk" FOREIGN KEY ("effective_user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mobile_push_devices_effective_user_enabled_idx" ON "mobile_push_devices" USING btree ("effective_user_id", "enabled");
