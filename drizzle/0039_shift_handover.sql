ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "handover_to_user_id" uuid;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "handover_from_shift_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shifts" ADD CONSTRAINT "shifts_handover_to_user_id_profiles_id_fk" FOREIGN KEY ("handover_to_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shifts_handover_to_user_idx" ON "shifts" USING btree ("handover_to_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shifts_handover_from_shift_idx" ON "shifts" USING btree ("handover_from_shift_id");
