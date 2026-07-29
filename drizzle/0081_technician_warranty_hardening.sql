ALTER TABLE "warranty_claim_notifications"
  ADD COLUMN "push_attempted_at" timestamptz,
  ADD COLUMN "push_dispatched_at" timestamptz,
  ADD COLUMN "push_claim_token" uuid,
  ADD COLUMN "push_claimed_at" timestamptz,
  ADD CONSTRAINT "warranty_claim_notifications_push_claim_check"
    CHECK (("push_claim_token" IS NULL) = ("push_claimed_at" IS NULL));
--> statement-breakpoint
CREATE INDEX "warranty_claim_notifications_push_idx"
  ON "warranty_claim_notifications" ("push_dispatched_at", "push_claimed_at", "created_at");
--> statement-breakpoint
ALTER TABLE "warranty_claim_notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "service_attachments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_warranty_claim_scope"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  job_project uuid;
  asset_project uuid;
  asset_job uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       OLD."project_id" IS DISTINCT FROM NEW."project_id"
       OR OLD."job_id" IS DISTINCT FROM NEW."job_id"
       OR OLD."asset_id" IS DISTINCT FROM NEW."asset_id"
     )
     AND EXISTS (
       SELECT 1 FROM "service_attachments"
       WHERE "claim_id" = OLD."id"
     ) THEN
    RAISE EXCEPTION 'SERVICE_WARRANTY_SCOPE_IMMUTABLE';
  END IF;

  IF NEW."job_id" IS NULL AND NEW."asset_id" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW."job_id" IS NULL OR NEW."asset_id" IS NULL THEN
    RAISE EXCEPTION 'SERVICE_WARRANTY_SCOPE_REQUIRED';
  END IF;

  SELECT "project_id" INTO job_project
  FROM "service_jobs"
  WHERE "id" = NEW."job_id"
  FOR KEY SHARE;

  SELECT "project_id", "job_id" INTO asset_project, asset_job
  FROM "installed_assets"
  WHERE "id" = NEW."asset_id"
  FOR KEY SHARE;

  IF job_project IS NULL
     OR asset_project IS NULL
     OR NEW."project_id" <> job_project
     OR NEW."project_id" <> asset_project
     OR NEW."job_id" IS DISTINCT FROM asset_job THEN
    RAISE EXCEPTION 'SERVICE_WARRANTY_SCOPE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_warranty_attachment_scope"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  claim_project uuid;
  claim_job uuid;
  claim_asset uuid;
BEGIN
  IF NEW."claim_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "project_id", "job_id", "asset_id"
    INTO claim_project, claim_job, claim_asset
  FROM "warranty_claims"
  WHERE "id" = NEW."claim_id"
  FOR KEY SHARE;

  IF claim_project IS NULL
     OR NEW."project_id" IS DISTINCT FROM claim_project
     OR NEW."job_id" IS DISTINCT FROM claim_job
     OR NEW."asset_id" IS DISTINCT FROM claim_asset
     OR NEW."category" <> 'issue' THEN
    RAISE EXCEPTION 'SERVICE_WARRANTY_ATTACHMENT_SCOPE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON TABLE "warranty_claim_notifications" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "warranty_claim_notifications" FROM anon, authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "enforce_warranty_claim_scope"() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "enforce_warranty_attachment_scope"() FROM PUBLIC, anon, authenticated;
