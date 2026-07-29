-- Bring the historically manual store_settings singleton into the tracked
-- migration baseline. Every statement is additive so existing rows, RLS, and
-- policies survive deployment to databases that already have the table.
CREATE TABLE IF NOT EXISTS "store_settings" (
  "id" text PRIMARY KEY DEFAULT 'default',
  "name" text NOT NULL DEFAULT '',
  "address" text NOT NULL DEFAULT '',
  "phone" text NOT NULL DEFAULT '',
  "tax_code" text NOT NULL DEFAULT '',
  "industry" text NOT NULL DEFAULT 'grocery',
  "currency" text NOT NULL DEFAULT 'VND',
  "locale" text NOT NULL DEFAULT 'vi-VN',
  "onboarded" boolean NOT NULL DEFAULT false,
  "prefs" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "name" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "address" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "phone" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "tax_code" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "industry" text NOT NULL DEFAULT 'grocery';
--> statement-breakpoint
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "currency" text NOT NULL DEFAULT 'VND';
--> statement-breakpoint
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "locale" text NOT NULL DEFAULT 'vi-VN';
--> statement-breakpoint
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "onboarded" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "prefs" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
INSERT INTO "store_settings" ("id")
VALUES ('default')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_recipients_user_visible_event_idx"
  ON "notification_recipients" ("user_id", "dismissed_at", "event_id");
