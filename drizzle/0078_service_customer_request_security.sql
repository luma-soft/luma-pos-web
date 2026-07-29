DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "service_customer_request_attachments"
    WHERE "mime_type" NOT IN ('image/jpeg', 'image/png', 'image/webp')
  ) THEN
    RAISE EXCEPTION 'SERVICE_CUSTOMER_REQUEST_NON_IMAGE_EVIDENCE_REQUIRES_REVIEW';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "service_customer_request_attachments"
  DROP CONSTRAINT "service_customer_request_attachments_mime_check",
  ADD COLUMN "width" integer,
  ADD COLUMN "height" integer,
  ADD CONSTRAINT "service_customer_request_attachments_mime_check"
    CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD CONSTRAINT "service_customer_request_attachments_dimensions_check"
    CHECK (
      ("width" IS NULL AND "height" IS NULL)
      OR (
        "width" > 0 AND "height" > 0
        AND "width" <= 6000 AND "height" <= 6000
        AND ("width"::bigint * "height"::bigint) <= 20000000
      )
    );
--> statement-breakpoint
ALTER TABLE "service_customer_requests"
  ADD CONSTRAINT "service_customer_requests_operational_job_check"
  CHECK (
    "status" NOT IN ('scheduled', 'in_progress', 'resolved', 'closed')
    OR "linked_job_id" IS NOT NULL
  ) NOT VALID;
ALTER TABLE "service_customer_requests"
  VALIDATE CONSTRAINT "service_customer_requests_operational_job_check";
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "service_customer_requests" request
    JOIN "service_jobs" job ON job."id" = request."linked_job_id"
    WHERE job."project_id" <> request."project_id"
  ) THEN
    RAISE EXCEPTION 'SERVICE_CUSTOMER_REQUEST_CROSS_PROJECT_JOB_REQUIRES_REVIEW';
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "validate_service_customer_request_job"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  job_project_id uuid;
BEGIN
  IF NEW."linked_job_id" IS NOT NULL THEN
    SELECT "project_id" INTO job_project_id
    FROM "service_jobs"
    WHERE "id" = NEW."linked_job_id";
    IF job_project_id IS NULL OR job_project_id <> NEW."project_id" THEN
      RAISE EXCEPTION 'CUSTOMER_REQUEST_JOB_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "service_customer_requests_job_scope_trigger"
BEFORE INSERT OR UPDATE OF "project_id", "linked_job_id", "status"
ON "service_customer_requests"
FOR EACH ROW
EXECUTE FUNCTION "validate_service_customer_request_job"();
--> statement-breakpoint
CREATE TABLE "service_customer_request_storage_cleanup" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid REFERENCES "service_customer_requests"("id") ON DELETE set null,
  "bucket" text NOT NULL,
  "path" text NOT NULL UNIQUE,
  "not_before" timestamptz NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "claim_token" uuid,
  "claimed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_customer_request_cleanup_claim_check"
    CHECK (("claim_token" IS NULL) = ("claimed_at" IS NULL)),
  CONSTRAINT "service_customer_request_cleanup_attempts_check"
    CHECK ("attempts" >= 0)
);
--> statement-breakpoint
CREATE INDEX "service_customer_request_cleanup_retry_idx"
  ON "service_customer_request_storage_cleanup" ("not_before", "claimed_at", "created_at");
ALTER TABLE "service_customer_request_storage_cleanup" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "service_customer_request_storage_cleanup" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "service_customer_request_storage_cleanup" FROM authenticated;
  END IF;
END $$;
