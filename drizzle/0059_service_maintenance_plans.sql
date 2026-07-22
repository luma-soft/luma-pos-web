CREATE TABLE "service_maintenance_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "asset_id" uuid,
  "title" text NOT NULL,
  "interval_days" integer NOT NULL,
  "next_due_on" date NOT NULL,
  "last_completed_on" date,
  "assigned_to" uuid,
  "is_active" boolean NOT NULL DEFAULT true,
  "note" text,
  "created_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_maintenance_plans_interval_check" CHECK ("interval_days" > 0)
);
--> statement-breakpoint
ALTER TABLE "service_maintenance_plans" ADD CONSTRAINT "service_maintenance_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_maintenance_plans" ADD CONSTRAINT "service_maintenance_plans_asset_id_installed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."installed_assets"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_maintenance_plans" ADD CONSTRAINT "service_maintenance_plans_assigned_to_profiles_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_maintenance_plans" ADD CONSTRAINT "service_maintenance_plans_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "service_maintenance_plans_due_idx" ON "service_maintenance_plans" ("is_active", "next_due_on");
--> statement-breakpoint
CREATE INDEX "service_maintenance_plans_project_idx" ON "service_maintenance_plans" ("project_id", "is_active");
