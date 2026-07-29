ALTER TABLE "service_customer_requests"
  ADD COLUMN "submitted_at" timestamptz,
  ADD COLUMN "responded_at" timestamptz,
  ADD COLUMN "resolved_at" timestamptz,
  ADD COLUMN "linked_job_id" uuid REFERENCES "service_jobs"("id") ON DELETE set null,
  ADD COLUMN "triaged_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
  ADD COLUMN "internal_note" text;
--> statement-breakpoint
CREATE INDEX "service_customer_requests_linked_job_idx"
  ON "service_customer_requests" ("linked_job_id")
  WHERE "linked_job_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "service_customer_request_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL REFERENCES "service_customer_requests"("id") ON DELETE cascade,
  "bucket" text NOT NULL,
  "path" text NOT NULL UNIQUE,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_customer_request_attachments_mime_check"
    CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  CONSTRAINT "service_customer_request_attachments_size_check"
    CHECK ("size_bytes" > 0 AND "size_bytes" <= 8388608),
  CONSTRAINT "service_customer_request_attachments_sha_check"
    CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "service_customer_request_attachments_request_idx"
  ON "service_customer_request_attachments" ("request_id", "created_at");
--> statement-breakpoint
CREATE TABLE "service_customer_request_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL REFERENCES "service_customer_requests"("id") ON DELETE cascade,
  "recipient_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE cascade,
  "notification_type" text NOT NULL,
  "read_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "service_customer_request_notifications_unique_idx"
  ON "service_customer_request_notifications" ("request_id", "recipient_id", "notification_type");
CREATE INDEX "service_customer_request_notifications_recipient_idx"
  ON "service_customer_request_notifications" ("recipient_id", "read_at", "created_at");
--> statement-breakpoint
CREATE TABLE "service_public_rate_limits" (
  "bucket_key" varchar(160) NOT NULL,
  "window_start" timestamptz NOT NULL,
  "request_count" integer NOT NULL DEFAULT 1,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "service_public_rate_limits_pkey" PRIMARY KEY ("bucket_key", "window_start"),
  CONSTRAINT "service_public_rate_limits_count_check" CHECK ("request_count" > 0)
);
--> statement-breakpoint
CREATE INDEX "service_public_rate_limits_expiry_idx" ON "service_public_rate_limits" ("expires_at");
--> statement-breakpoint
ALTER TABLE "service_customer_request_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_customer_request_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_public_rate_limits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE
      "service_customer_request_attachments",
      "service_customer_request_notifications",
      "service_public_rate_limits"
    FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE
      "service_customer_request_attachments",
      "service_customer_request_notifications",
      "service_public_rate_limits"
    FROM authenticated;
  END IF;
END $$;
