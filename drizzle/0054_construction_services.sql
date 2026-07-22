CREATE TYPE "service_type" AS ENUM ('camera', 'electrical', 'plumbing', 'mixed');
--> statement-breakpoint
CREATE TYPE "service_project_stage" AS ENUM ('planning', 'quoted', 'active', 'paused', 'completed', 'warranty', 'cancelled');
--> statement-breakpoint
CREATE TYPE "service_job_status" AS ENUM ('new', 'scheduled', 'in_progress', 'waiting_materials', 'waiting_customer', 'completed', 'warranty', 'cancelled');
--> statement-breakpoint
CREATE TYPE "service_job_priority" AS ENUM ('low', 'normal', 'high', 'urgent');
--> statement-breakpoint
CREATE TYPE "service_asset_status" AS ENUM ('installed', 'repair', 'replaced', 'removed');
--> statement-breakpoint
CREATE TYPE "warranty_claim_status" AS ENUM ('new', 'scheduled', 'in_progress', 'waiting_materials', 'waiting_supplier', 'resolved', 'closed', 'void');
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "service_type" "service_type";
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "service_stage" "service_project_stage";
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "progress_percent" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "starts_on" date;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "target_ends_on" date;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "site_contact_name" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "site_contact_phone" varchar(20);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_progress_percent_check" CHECK ("progress_percent" BETWEEN 0 AND 100);
--> statement-breakpoint
CREATE TABLE "service_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "code" varchar(30) NOT NULL,
  "service_type" "service_type" NOT NULL,
  "title" text NOT NULL,
  "status" "service_job_status" NOT NULL DEFAULT 'new',
  "priority" "service_job_priority" NOT NULL DEFAULT 'normal',
  "assigned_to" uuid,
  "scheduled_at" timestamptz,
  "completed_at" timestamptz,
  "description" text,
  "checklist" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "quote_order_id" uuid,
  "material_order_id" uuid,
  "completion_note" text,
  "created_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_jobs_code_unique" UNIQUE ("code")
);
--> statement-breakpoint
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_assigned_to_profiles_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_quote_order_id_orders_id_fk" FOREIGN KEY ("quote_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_material_order_id_orders_id_fk" FOREIGN KEY ("material_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "service_jobs_project_idx" ON "service_jobs" ("project_id", "created_at");
--> statement-breakpoint
CREATE INDEX "service_jobs_status_schedule_idx" ON "service_jobs" ("status", "scheduled_at");
--> statement-breakpoint
CREATE INDEX "service_jobs_assignee_idx" ON "service_jobs" ("assigned_to", "status");
--> statement-breakpoint
CREATE TABLE "service_job_materials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "unit_name" varchar(30) NOT NULL,
  "planned_quantity" numeric(14,4) NOT NULL DEFAULT 0,
  "used_quantity" numeric(14,4) NOT NULL DEFAULT 0,
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_job_materials_quantity_check" CHECK ("planned_quantity" >= 0 AND "used_quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "service_job_materials" ADD CONSTRAINT "service_job_materials_job_id_service_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."service_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_job_materials" ADD CONSTRAINT "service_job_materials_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "service_job_materials_job_product_unit_idx" ON "service_job_materials" ("job_id", "product_id", "unit_name");
--> statement-breakpoint
CREATE INDEX "service_job_materials_product_idx" ON "service_job_materials" ("product_id");
--> statement-breakpoint
CREATE TABLE "installed_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "job_id" uuid,
  "product_id" uuid,
  "asset_kind" text NOT NULL,
  "name" text NOT NULL,
  "brand" text,
  "model" text,
  "serial_number" text,
  "mac_address" text,
  "ip_address" text,
  "location_label" text,
  "installed_at" timestamptz,
  "customer_warranty_ends_on" date,
  "supplier_warranty_ends_on" date,
  "status" "service_asset_status" NOT NULL DEFAULT 'installed',
  "note" text,
  "created_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "installed_assets" ADD CONSTRAINT "installed_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "installed_assets" ADD CONSTRAINT "installed_assets_job_id_service_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."service_jobs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "installed_assets" ADD CONSTRAINT "installed_assets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "installed_assets" ADD CONSTRAINT "installed_assets_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "installed_assets_project_idx" ON "installed_assets" ("project_id", "status");
--> statement-breakpoint
CREATE INDEX "installed_assets_job_idx" ON "installed_assets" ("job_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "installed_assets_serial_idx" ON "installed_assets" ("serial_number");
--> statement-breakpoint
CREATE TABLE "warranty_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "job_id" uuid,
  "asset_id" uuid,
  "code" varchar(30) NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "status" "warranty_claim_status" NOT NULL DEFAULT 'new',
  "priority" "service_job_priority" NOT NULL DEFAULT 'normal',
  "reported_at" timestamptz NOT NULL DEFAULT now(),
  "scheduled_at" timestamptz,
  "resolved_at" timestamptz,
  "diagnosis" text,
  "resolution" text,
  "labor_charge" numeric(14,2) NOT NULL DEFAULT 0,
  "material_charge" numeric(14,2) NOT NULL DEFAULT 0,
  "created_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "warranty_claims_code_unique" UNIQUE ("code"),
  CONSTRAINT "warranty_claims_charge_check" CHECK ("labor_charge" >= 0 AND "material_charge" >= 0)
);
--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_job_id_service_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."service_jobs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_asset_id_installed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."installed_assets"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "warranty_claims_project_idx" ON "warranty_claims" ("project_id", "status");
--> statement-breakpoint
CREATE INDEX "warranty_claims_asset_idx" ON "warranty_claims" ("asset_id");
--> statement-breakpoint
CREATE INDEX "warranty_claims_schedule_idx" ON "warranty_claims" ("status", "scheduled_at");
--> statement-breakpoint
CREATE TABLE "service_status_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL,
  "from_status" "service_job_status",
  "to_status" "service_job_status" NOT NULL,
  "note" text,
  "created_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "service_status_logs" ADD CONSTRAINT "service_status_logs_job_id_service_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."service_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_status_logs" ADD CONSTRAINT "service_status_logs_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "service_status_logs_job_idx" ON "service_status_logs" ("job_id", "created_at");
