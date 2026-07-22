CREATE TABLE "service_cost_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "job_id" uuid,
  "type" text NOT NULL,
  "description" text NOT NULL,
  "quantity" numeric(14,4) NOT NULL DEFAULT 1,
  "unit_cost" numeric(14,2) NOT NULL DEFAULT 0,
  "amount" numeric(14,2) NOT NULL DEFAULT 0,
  "staff_id" uuid,
  "incurred_on" date NOT NULL DEFAULT CURRENT_DATE,
  "note" text,
  "created_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_cost_entries_type_check" CHECK ("type" IN ('labor', 'subcontractor', 'transport', 'other')),
  CONSTRAINT "service_cost_entries_amount_check" CHECK ("quantity" >= 0 AND "unit_cost" >= 0 AND "amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "service_cost_entries" ADD CONSTRAINT "service_cost_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_cost_entries" ADD CONSTRAINT "service_cost_entries_job_id_service_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."service_jobs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_cost_entries" ADD CONSTRAINT "service_cost_entries_staff_id_profiles_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_cost_entries" ADD CONSTRAINT "service_cost_entries_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "service_cost_entries_project_idx" ON "service_cost_entries" ("project_id", "incurred_on");
--> statement-breakpoint
CREATE INDEX "service_cost_entries_job_idx" ON "service_cost_entries" ("job_id");
