CREATE TABLE "notification_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_key" varchar(200) NOT NULL UNIQUE,
  "category" varchar(40) NOT NULL,
  "entity_type" varchar(40) NOT NULL,
  "entity_id" uuid NOT NULL,
  "actor_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  "target" varchar(40) NOT NULL,
  "priority" varchar(16) NOT NULL,
  "quiet_hours_policy" varchar(16) NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notification_events_category_created_idx"
  ON "notification_events" ("category", "created_at");
--> statement-breakpoint
CREATE TABLE "notification_recipients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "notification_events"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "reason" varchar(16) NOT NULL,
  "read_at" timestamptz,
  "dismissed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "notification_recipients_event_user_unique" UNIQUE ("event_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX "notification_recipients_user_created_idx"
  ON "notification_recipients" ("user_id", "created_at");
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL UNIQUE REFERENCES "notification_events"("id") ON DELETE CASCADE,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "provider" varchar(32),
  "provider_message_id" varchar(180),
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "available_at" timestamptz DEFAULT now() NOT NULL,
  "lease_expires_at" timestamptz,
  "last_error_code" varchar(80),
  "published_at" timestamptz,
  "first_attempt_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notification_outbox_status_available_idx"
  ON "notification_outbox" ("status", "available_at");
