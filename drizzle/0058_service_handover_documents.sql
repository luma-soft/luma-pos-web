CREATE TABLE "service_handover_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "job_id" uuid,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "content" text,
  "photo_urls" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "signed_by" text,
  "signed_at" date,
  "status" text NOT NULL DEFAULT 'draft',
  "created_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_handover_documents_type_check" CHECK ("type" IN ('survey', 'acceptance', 'handover')),
  CONSTRAINT "service_handover_documents_status_check" CHECK ("status" IN ('draft', 'signed'))
);
--> statement-breakpoint
ALTER TABLE "service_handover_documents" ADD CONSTRAINT "service_handover_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_handover_documents" ADD CONSTRAINT "service_handover_documents_job_id_service_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."service_jobs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_handover_documents" ADD CONSTRAINT "service_handover_documents_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "service_handover_documents_project_idx" ON "service_handover_documents" ("project_id", "created_at");
