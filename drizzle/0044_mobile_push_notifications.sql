CREATE TABLE IF NOT EXISTS "mobile_push_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" varchar(120) NOT NULL,
	"platform" varchar(20) NOT NULL,
	"token" text NOT NULL,
	"permission" varchar(20) DEFAULT 'authorized' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"locale" varchar(20),
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_push_devices_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mobile_push_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"notification_key" varchar(180) NOT NULL,
	"status" varchar(20) NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"error_code" varchar(80),
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mobile_push_devices" ADD CONSTRAINT "mobile_push_devices_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mobile_push_deliveries" ADD CONSTRAINT "mobile_push_deliveries_device_id_mobile_push_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."mobile_push_devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mobile_push_devices_user_device_idx" ON "mobile_push_devices" USING btree ("user_id", "device_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mobile_push_devices_user_enabled_idx" ON "mobile_push_devices" USING btree ("user_id", "enabled");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mobile_push_deliveries_device_notification_idx" ON "mobile_push_deliveries" USING btree ("device_id", "notification_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mobile_push_deliveries_status_idx" ON "mobile_push_deliveries" USING btree ("status", "attempted_at");
