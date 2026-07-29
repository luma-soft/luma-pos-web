DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "service_maintenance_occurrences"
    WHERE "status" IN ('scheduled', 'overdue')
    GROUP BY "plan_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'SERVICE_MAINTENANCE_MULTIPLE_OUTSTANDING';
  END IF;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX "service_maintenance_occurrences_plan_outstanding_idx"
  ON "service_maintenance_occurrences" ("plan_id")
  WHERE "status" IN ('scheduled', 'overdue');
--> statement-breakpoint
ALTER TABLE "service_maintenance_occurrences"
  DROP CONSTRAINT "service_maintenance_occurrences_plan_id_fkey";
--> statement-breakpoint
ALTER TABLE "service_maintenance_occurrences"
  ADD CONSTRAINT "service_maintenance_occurrences_plan_id_fkey"
  FOREIGN KEY ("plan_id")
  REFERENCES "service_maintenance_plans"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "mobile_push_deliveries"
  ADD COLUMN "claim_token" uuid;
--> statement-breakpoint
ALTER TABLE "mobile_push_deliveries"
  ADD COLUMN "claimed_at" timestamptz;
--> statement-breakpoint
CREATE INDEX "mobile_push_deliveries_claim_idx"
  ON "mobile_push_deliveries" ("status", "claimed_at")
  WHERE "status" = 'sending';
--> statement-breakpoint
ALTER TABLE "mobile_push_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "pg_roles" WHERE "rolname" = 'anon') THEN
    REVOKE ALL ON TABLE "mobile_push_deliveries" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM "pg_roles" WHERE "rolname" = 'authenticated') THEN
    REVOKE ALL ON TABLE "mobile_push_deliveries" FROM authenticated;
  END IF;
END
$$;
