ALTER TABLE "service_maintenance_plans"
  ADD COLUMN "service_type" "service_type";
--> statement-breakpoint
UPDATE "service_maintenance_plans" AS plan
SET "service_type" = project."service_type"
FROM "projects" AS project
WHERE project."id" = plan."project_id"
  AND project."service_type" IN ('camera', 'electrical', 'plumbing');
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "service_maintenance_plans"
    WHERE "service_type" IS NULL
       OR "service_type" = 'mixed'
  ) THEN
    RAISE EXCEPTION
      'SERVICE_MAINTENANCE_SERVICE_TYPE_REQUIRED: explicitly classify legacy mixed-project maintenance plans';
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "service_maintenance_plans"
  ALTER COLUMN "service_type" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_maintenance_plans"
  ADD CONSTRAINT "service_maintenance_plans_service_type_check"
  CHECK ("service_type" IN ('camera', 'electrical', 'plumbing'));
--> statement-breakpoint
CREATE UNIQUE INDEX "service_maintenance_occurrences_job_idx"
  ON "service_maintenance_occurrences" ("job_id")
  WHERE "job_id" IS NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "pg_roles" WHERE "rolname" = 'anon') THEN
    REVOKE ALL ON TABLE
      "service_maintenance_plans",
      "service_maintenance_occurrences"
    FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM "pg_roles" WHERE "rolname" = 'authenticated') THEN
    REVOKE ALL ON TABLE
      "service_maintenance_plans",
      "service_maintenance_occurrences"
    FROM authenticated;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
DECLARE
  app_role text;
BEGIN
  FOR app_role IN
    SELECT "rolname"
    FROM "pg_roles"
    WHERE "rolname" IN ('anon', 'authenticated')
  LOOP
    IF has_table_privilege(app_role, 'service_maintenance_plans', 'INSERT')
       OR has_table_privilege(app_role, 'service_maintenance_occurrences', 'INSERT')
    THEN
      RAISE EXCEPTION 'service maintenance tables must remain server-write-only';
    END IF;
  END LOOP;
END
$$;
