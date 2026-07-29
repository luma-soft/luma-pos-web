ALTER TABLE "service_attachments"
  ADD COLUMN "claim_id" uuid REFERENCES "warranty_claims"("id") ON DELETE cascade,
  ADD COLUMN "asset_id" uuid REFERENCES "installed_assets"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX "service_attachments_claim_idx"
  ON "service_attachments" ("claim_id", "created_at");
--> statement-breakpoint
CREATE TABLE "warranty_claim_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "claim_id" uuid NOT NULL REFERENCES "warranty_claims"("id") ON DELETE cascade,
  "recipient_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE cascade,
  "notification_type" text NOT NULL DEFAULT 'created',
  "read_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "warranty_claim_notifications_type_check"
    CHECK ("notification_type" IN ('created', 'status_changed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "warranty_claim_notifications_claim_recipient_type_idx"
  ON "warranty_claim_notifications" ("claim_id", "recipient_id", "notification_type");
--> statement-breakpoint
CREATE INDEX "warranty_claim_notifications_recipient_idx"
  ON "warranty_claim_notifications" ("recipient_id", "read_at", "created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_warranty_claim_scope"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  job_project uuid;
  asset_project uuid;
BEGIN
  IF NEW."job_id" IS NULL OR NEW."asset_id" IS NULL THEN
    RAISE EXCEPTION 'SERVICE_WARRANTY_SCOPE_REQUIRED';
  END IF;

  SELECT "project_id" INTO job_project
  FROM "service_jobs"
  WHERE "id" = NEW."job_id"
  FOR KEY SHARE;

  SELECT "project_id" INTO asset_project
  FROM "installed_assets"
  WHERE "id" = NEW."asset_id"
  FOR KEY SHARE;

  IF job_project IS NULL
     OR asset_project IS NULL
     OR NEW."project_id" <> job_project
     OR NEW."project_id" <> asset_project THEN
    RAISE EXCEPTION 'SERVICE_WARRANTY_SCOPE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "warranty_claims_scope_guard"
BEFORE INSERT OR UPDATE OF "project_id", "job_id", "asset_id"
ON "warranty_claims"
FOR EACH ROW EXECUTE FUNCTION "enforce_warranty_claim_scope"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_warranty_attachment_scope"()
RETURNS trigger
LANGUAGE plpgsql
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
CREATE TRIGGER "service_attachments_warranty_scope_guard"
BEFORE INSERT OR UPDATE OF "project_id", "job_id", "claim_id", "asset_id", "category"
ON "service_attachments"
FOR EACH ROW EXECUTE FUNCTION "enforce_warranty_attachment_scope"();
--> statement-breakpoint
DO $$
DECLARE
  app_role text;
BEGIN
  FOREACH app_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE ON TABLE "warranty_claim_notifications" FROM %I',
        app_role
      );
    END IF;
  END LOOP;
END;
$$;
