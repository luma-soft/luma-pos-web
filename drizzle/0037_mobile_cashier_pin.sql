ALTER TABLE "profiles" ADD COLUMN "cashier_pin_hash" text;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "cashier_pin_failed_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "cashier_pin_locked_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "cashier_pin_updated_at" timestamp with time zone;
