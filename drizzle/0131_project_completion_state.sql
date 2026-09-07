ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone;

-- Project status is the canonical completion signal. Keep operational stages
-- intact, and only repair rows already marked done.
UPDATE "projects"
SET
  "service_stage" = 'completed',
  "progress_percent" = 100
WHERE "service_type" IS NOT NULL
  AND "status" = 'done';

ALTER TABLE "projects"
  DROP CONSTRAINT IF EXISTS "projects_status_check";
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_status_check"
  CHECK ("status" IN ('active', 'done'));

ALTER TABLE "projects"
  DROP CONSTRAINT IF EXISTS "projects_done_stage_check";
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_done_stage_check"
  CHECK (
    "service_type" IS NULL
    OR "status" <> 'done'
    OR "service_stage" = 'completed'
  );

CREATE INDEX IF NOT EXISTS "projects_store_target_active_idx"
  ON "projects" ("store_id", "target_ends_on")
  WHERE "service_type" IS NOT NULL
    AND "status" = 'active'
    AND "target_ends_on" IS NOT NULL;
