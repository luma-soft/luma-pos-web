ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'technician';
--> statement-breakpoint
CREATE TABLE "service_job_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL REFERENCES "service_jobs"("id") ON DELETE cascade,
  "profile_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE cascade,
  "assignment_role" text NOT NULL DEFAULT 'crew',
  "assigned_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
  "assigned_at" timestamptz NOT NULL DEFAULT now(),
  "removed_at" timestamptz,
  CONSTRAINT "service_job_assignments_role_check" CHECK ("assignment_role" IN ('primary', 'crew'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "service_job_assignments_job_profile_idx" ON "service_job_assignments" ("job_id", "profile_id");
--> statement-breakpoint
CREATE INDEX "service_job_assignments_profile_active_idx" ON "service_job_assignments" ("profile_id", "removed_at");
--> statement-breakpoint
CREATE TABLE "service_visits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL REFERENCES "service_jobs"("id") ON DELETE cascade,
  "profile_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE cascade,
  "status" text NOT NULL DEFAULT 'active',
  "checked_in_at" timestamptz NOT NULL DEFAULT now(),
  "checked_out_at" timestamptz,
  "check_in_latitude" numeric(9,6),
  "check_in_longitude" numeric(9,6),
  "check_out_latitude" numeric(9,6),
  "check_out_longitude" numeric(9,6),
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_visits_status_check" CHECK ("status" IN ('active', 'completed', 'cancelled')),
  CONSTRAINT "service_visits_check_out_check" CHECK ("checked_out_at" IS NULL OR "checked_out_at" >= "checked_in_at")
);
--> statement-breakpoint
CREATE INDEX "service_visits_job_time_idx" ON "service_visits" ("job_id", "checked_in_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "service_visits_profile_active_idx" ON "service_visits" ("profile_id") WHERE "status" = 'active';
--> statement-breakpoint
CREATE TABLE "service_time_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL REFERENCES "service_jobs"("id") ON DELETE cascade,
  "visit_id" uuid REFERENCES "service_visits"("id") ON DELETE set null,
  "profile_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE cascade,
  "entry_type" text NOT NULL DEFAULT 'work',
  "started_at" timestamptz NOT NULL,
  "ended_at" timestamptz,
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_time_entries_type_check" CHECK ("entry_type" IN ('work', 'travel')),
  CONSTRAINT "service_time_entries_end_check" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at")
);
--> statement-breakpoint
CREATE INDEX "service_time_entries_job_profile_idx" ON "service_time_entries" ("job_id", "profile_id", "started_at");
--> statement-breakpoint
CREATE TABLE "service_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "job_id" uuid REFERENCES "service_jobs"("id") ON DELETE cascade,
  "request_id" uuid,
  "category" text NOT NULL,
  "bucket" varchar(80) NOT NULL,
  "path" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" varchar(120) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256" varchar(64),
  "caption" text,
  "created_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_attachments_category_check" CHECK ("category" IN ('before', 'after', 'issue', 'document', 'signature')),
  CONSTRAINT "service_attachments_size_check" CHECK ("size_bytes" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "service_attachments_bucket_path_idx" ON "service_attachments" ("bucket", "path");
--> statement-breakpoint
CREATE INDEX "service_attachments_job_idx" ON "service_attachments" ("job_id", "created_at");
--> statement-breakpoint
CREATE TABLE "service_signatures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "job_id" uuid NOT NULL REFERENCES "service_jobs"("id") ON DELETE cascade,
  "document_id" uuid REFERENCES "service_handover_documents"("id") ON DELETE set null,
  "attachment_id" uuid NOT NULL REFERENCES "service_attachments"("id") ON DELETE restrict,
  "signer_name" text NOT NULL,
  "signer_role" text,
  "document_hash" varchar(64) NOT NULL,
  "signed_by_profile_id" uuid REFERENCES "profiles"("id") ON DELETE set null,
  "signed_at" timestamptz NOT NULL DEFAULT now(),
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "service_signatures_hash_check" CHECK ("document_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "service_signatures_job_idx" ON "service_signatures" ("job_id", "signed_at");
--> statement-breakpoint
CREATE TABLE "service_job_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL REFERENCES "service_jobs"("id") ON DELETE cascade,
  "event_type" text NOT NULL,
  "actor_id" uuid REFERENCES "profiles"("id") ON DELETE set null,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "service_job_events_job_idx" ON "service_job_events" ("job_id", "created_at");
--> statement-breakpoint
CREATE TABLE "service_field_mutations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_mutation_id" varchar(100) NOT NULL,
  "actor_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE cascade,
  "job_id" uuid NOT NULL REFERENCES "service_jobs"("id") ON DELETE cascade,
  "operation" text NOT NULL,
  "result" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "service_field_mutations_client_idx" ON "service_field_mutations" ("actor_id", "client_mutation_id");
--> statement-breakpoint
CREATE TABLE "service_maintenance_occurrences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plan_id" uuid NOT NULL REFERENCES "service_maintenance_plans"("id") ON DELETE cascade,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "job_id" uuid REFERENCES "service_jobs"("id") ON DELETE set null,
  "due_on" date NOT NULL,
  "status" text NOT NULL DEFAULT 'scheduled',
  "generated_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  CONSTRAINT "service_maintenance_occurrences_status_check" CHECK ("status" IN ('scheduled', 'completed', 'skipped', 'overdue'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "service_maintenance_occurrences_plan_due_idx" ON "service_maintenance_occurrences" ("plan_id", "due_on");
--> statement-breakpoint
CREATE INDEX "service_maintenance_occurrences_due_idx" ON "service_maintenance_occurrences" ("status", "due_on");
--> statement-breakpoint
CREATE TABLE "service_sla_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "priority" "service_job_priority" NOT NULL,
  "response_minutes" integer NOT NULL,
  "resolution_minutes" integer NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_sla_policies_minutes_check" CHECK ("response_minutes" > 0 AND "resolution_minutes" >= "response_minutes")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "service_sla_policies_priority_active_idx" ON "service_sla_policies" ("priority") WHERE "is_active";
--> statement-breakpoint
CREATE TABLE "service_customer_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(30) NOT NULL UNIQUE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE set null,
  "asset_id" uuid REFERENCES "installed_assets"("id") ON DELETE set null,
  "claim_id" uuid REFERENCES "warranty_claims"("id") ON DELETE set null,
  "title" text NOT NULL,
  "description" text,
  "contact_name" text NOT NULL,
  "contact_phone" varchar(20),
  "priority" "service_job_priority" NOT NULL DEFAULT 'normal',
  "status" text NOT NULL DEFAULT 'new',
  "token_hash" varchar(64) NOT NULL,
  "token_expires_at" timestamptz NOT NULL,
  "response_due_at" timestamptz,
  "resolution_due_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_customer_requests_status_check" CHECK ("status" IN ('new', 'triaged', 'scheduled', 'in_progress', 'resolved', 'closed', 'void'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "service_customer_requests_token_idx" ON "service_customer_requests" ("token_hash");
--> statement-breakpoint
CREATE INDEX "service_customer_requests_sla_idx" ON "service_customer_requests" ("status", "response_due_at", "resolution_due_at");
--> statement-breakpoint
ALTER TABLE "service_attachments" ADD CONSTRAINT "service_attachments_request_id_service_customer_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "service_customer_requests"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE TABLE "camera_vendor_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vendor" text NOT NULL,
  "name" text NOT NULL,
  "region" varchar(40),
  "status" text NOT NULL DEFAULT 'disabled',
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_synced_at" timestamptz,
  "created_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "camera_vendor_connections_vendor_check" CHECK ("vendor" IN ('ezviz', 'hikvision', 'dahua', 'uniview')),
  CONSTRAINT "camera_vendor_connections_status_check" CHECK ("status" IN ('disabled', 'active', 'error'))
);
--> statement-breakpoint
CREATE TABLE "camera_device_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "connection_id" uuid NOT NULL REFERENCES "camera_vendor_connections"("id") ON DELETE cascade,
  "asset_id" uuid NOT NULL REFERENCES "installed_assets"("id") ON DELETE cascade,
  "external_device_id" text NOT NULL,
  "vendor_app_url" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "camera_device_links_connection_external_idx" ON "camera_device_links" ("connection_id", "external_device_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "camera_device_links_asset_connection_idx" ON "camera_device_links" ("asset_id", "connection_id");
--> statement-breakpoint
CREATE TABLE "camera_health_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_link_id" uuid NOT NULL REFERENCES "camera_device_links"("id") ON DELETE cascade,
  "online" boolean,
  "status" text NOT NULL DEFAULT 'unknown',
  "last_seen_at" timestamptz,
  "firmware_version" text,
  "storage_status" text,
  "channel_count" integer,
  "captured_at" timestamptz NOT NULL DEFAULT now(),
  "raw_hash" varchar(64),
  CONSTRAINT "camera_health_snapshots_status_check" CHECK ("status" IN ('healthy', 'warning', 'offline', 'unknown'))
);
--> statement-breakpoint
CREATE INDEX "camera_health_snapshots_device_idx" ON "camera_health_snapshots" ("device_link_id", "captured_at");
--> statement-breakpoint
CREATE TABLE "camera_device_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_link_id" uuid NOT NULL REFERENCES "camera_device_links"("id") ON DELETE cascade,
  "external_alert_id" text NOT NULL,
  "alert_type" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'warning',
  "message" text,
  "occurred_at" timestamptz NOT NULL,
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "camera_device_alerts_severity_check" CHECK ("severity" IN ('info', 'warning', 'critical'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "camera_device_alerts_device_external_idx" ON "camera_device_alerts" ("device_link_id", "external_alert_id");
--> statement-breakpoint
CREATE INDEX "camera_device_alerts_open_idx" ON "camera_device_alerts" ("device_link_id", "resolved_at", "occurred_at");
--> statement-breakpoint
CREATE TABLE "camera_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "connection_id" uuid NOT NULL REFERENCES "camera_vendor_connections"("id") ON DELETE cascade,
  "status" text NOT NULL DEFAULT 'running',
  "device_count" integer NOT NULL DEFAULT 0,
  "alert_count" integer NOT NULL DEFAULT 0,
  "error_code" text,
  "error_message" text,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  CONSTRAINT "camera_sync_runs_status_check" CHECK ("status" IN ('running', 'succeeded', 'partial', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "camera_sync_runs_connection_idx" ON "camera_sync_runs" ("connection_id", "started_at");
--> statement-breakpoint
ALTER TABLE "service_job_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_time_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_signatures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_job_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_field_mutations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_maintenance_occurrences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_sla_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_customer_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "camera_vendor_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "camera_device_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "camera_health_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "camera_device_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "camera_sync_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE
      "service_job_assignments", "service_visits", "service_time_entries",
      "service_attachments", "service_signatures", "service_job_events",
      "service_field_mutations", "service_maintenance_occurrences",
      "service_sla_policies", "service_customer_requests",
      "camera_vendor_connections", "camera_device_links",
      "camera_health_snapshots", "camera_device_alerts", "camera_sync_runs"
    FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE
      "service_job_assignments", "service_visits", "service_time_entries",
      "service_attachments", "service_signatures", "service_job_events",
      "service_field_mutations", "service_maintenance_occurrences",
      "service_sla_policies", "service_customer_requests",
      "camera_vendor_connections", "camera_device_links",
      "camera_health_snapshots", "camera_device_alerts", "camera_sync_runs"
    FROM authenticated;
  END IF;
END $$;
