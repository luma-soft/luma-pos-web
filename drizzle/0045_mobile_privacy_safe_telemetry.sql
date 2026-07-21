CREATE TABLE IF NOT EXISTS "mobile_telemetry_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "event_type" varchar(32) NOT NULL,
  "platform" varchar(16) NOT NULL,
  "app_version" varchar(32) NOT NULL,
  "metric" varchar(32),
  "screen" varchar(32),
  "duration_ms" integer,
  "success" boolean,
  "error_type" varchar(80),
  "fingerprint" varchar(16),
  "attempted_count" integer,
  "succeeded_count" integer,
  "failed_count" integer,
  "conflict_count" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "mobile_telemetry_events_type_created_idx"
  ON "mobile_telemetry_events" ("event_type", "created_at");
