CREATE TABLE IF NOT EXISTS "ai_usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "period" varchar(7) NOT NULL,
  "provider" text,
  "model" text,
  "action_type" text DEFAULT 'assistant_request' NOT NULL,
  "event_type" text DEFAULT 'unit_charge' NOT NULL,
  "surface" text DEFAULT 'web' NOT NULL,
  "units" integer DEFAULT 0 NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "total_tokens" integer DEFAULT 0 NOT NULL,
  "estimated_cost_microusd" integer DEFAULT 0 NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "ai_usage_events_period_idx"
  ON "ai_usage_events" USING btree ("period","created_at");
CREATE INDEX IF NOT EXISTS "ai_usage_events_action_idx"
  ON "ai_usage_events" USING btree ("action_type","created_at");
CREATE INDEX IF NOT EXISTS "ai_usage_events_provider_idx"
  ON "ai_usage_events" USING btree ("provider","model");
