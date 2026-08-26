ALTER TABLE "installed_assets"
  ADD COLUMN "specs" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
CREATE TABLE "service_job_trade_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL REFERENCES "stores"("id"),
  "job_id" uuid NOT NULL REFERENCES "service_jobs"("id") ON DELETE cascade,
  "service_type" "service_type" NOT NULL,
  "schema_version" integer DEFAULT 1 NOT NULL,
  "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "service_job_trade_records_job_unique" UNIQUE("job_id"),
  CONSTRAINT "service_job_trade_records_job_store_fk" FOREIGN KEY ("store_id", "job_id") REFERENCES "service_jobs"("store_id", "id") ON DELETE cascade,
  CONSTRAINT "service_job_trade_records_type_check" CHECK ("service_type" IN ('camera', 'electrical', 'plumbing')),
  CONSTRAINT "service_job_trade_records_version_check" CHECK ("schema_version" > 0 AND "version" > 0),
  CONSTRAINT "service_job_trade_records_store_id_id_unique" UNIQUE("store_id", "id")
);
--> statement-breakpoint
CREATE INDEX "service_job_trade_records_store_type_idx" ON "service_job_trade_records" ("store_id", "service_type");
--> statement-breakpoint
CREATE TABLE "service_job_dependencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL REFERENCES "stores"("id"),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "predecessor_job_id" uuid NOT NULL REFERENCES "service_jobs"("id") ON DELETE cascade,
  "successor_job_id" uuid NOT NULL REFERENCES "service_jobs"("id") ON DELETE cascade,
  "dependency_type" text DEFAULT 'finish_to_start' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "note" text,
  "created_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "service_job_dependencies_pair_unique" UNIQUE("predecessor_job_id", "successor_job_id"),
  CONSTRAINT "service_job_dependencies_project_store_fk" FOREIGN KEY ("store_id", "project_id") REFERENCES "projects"("store_id", "id") ON DELETE cascade,
  CONSTRAINT "service_job_dependencies_predecessor_store_fk" FOREIGN KEY ("store_id", "predecessor_job_id") REFERENCES "service_jobs"("store_id", "id") ON DELETE cascade,
  CONSTRAINT "service_job_dependencies_successor_store_fk" FOREIGN KEY ("store_id", "successor_job_id") REFERENCES "service_jobs"("store_id", "id") ON DELETE cascade,
  CONSTRAINT "service_job_dependencies_not_self_check" CHECK ("predecessor_job_id" <> "successor_job_id"),
  CONSTRAINT "service_job_dependencies_type_check" CHECK ("dependency_type" IN ('finish_to_start', 'evidence_required', 'handoff')),
  CONSTRAINT "service_job_dependencies_status_check" CHECK ("status" IN ('pending', 'ready', 'blocked', 'completed', 'waived')),
  CONSTRAINT "service_job_dependencies_store_id_id_unique" UNIQUE("store_id", "id")
);
--> statement-breakpoint
CREATE INDEX "service_job_dependencies_project_idx" ON "service_job_dependencies" ("project_id", "status");
--> statement-breakpoint
CREATE TABLE "service_coordination_points" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL REFERENCES "stores"("id"),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "title" text NOT NULL,
  "location_label" text,
  "service_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "description" text,
  "assigned_to" uuid REFERENCES "profiles"("id") ON DELETE set null,
  "due_at" timestamptz,
  "is_acceptance_required" boolean DEFAULT true NOT NULL,
  "created_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "service_coordination_points_status_check" CHECK ("status" IN ('open', 'ready', 'blocked', 'resolved', 'waived')),
  CONSTRAINT "service_coordination_points_project_store_fk" FOREIGN KEY ("store_id", "project_id") REFERENCES "projects"("store_id", "id") ON DELETE cascade,
  CONSTRAINT "service_coordination_points_types_check" CHECK (jsonb_typeof("service_types") = 'array' AND jsonb_array_length("service_types") >= 2),
  CONSTRAINT "service_coordination_points_store_id_id_unique" UNIQUE("store_id", "id")
);
--> statement-breakpoint
CREATE INDEX "service_coordination_points_project_idx" ON "service_coordination_points" ("project_id", "status");
--> statement-breakpoint
CREATE TABLE "service_camera_vaults" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL REFERENCES "stores"("id"),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "asset_id" uuid NOT NULL REFERENCES "installed_assets"("id") ON DELETE cascade,
  "ciphertext" text NOT NULL,
  "iv" varchar(24) NOT NULL,
  "auth_tag" varchar(32) NOT NULL,
  "key_version" integer DEFAULT 1 NOT NULL,
  "configured" boolean DEFAULT false NOT NULL,
  "rotated_at" timestamptz,
  "rotated_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
  "created_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "service_camera_vaults_asset_unique" UNIQUE("asset_id"),
  CONSTRAINT "service_camera_vaults_project_store_fk" FOREIGN KEY ("store_id", "project_id") REFERENCES "projects"("store_id", "id") ON DELETE cascade,
  CONSTRAINT "service_camera_vaults_asset_store_fk" FOREIGN KEY ("store_id", "asset_id") REFERENCES "installed_assets"("store_id", "id") ON DELETE cascade,
  CONSTRAINT "service_camera_vaults_key_version_check" CHECK ("key_version" > 0),
  CONSTRAINT "service_camera_vaults_store_id_id_unique" UNIQUE("store_id", "id")
);
--> statement-breakpoint
CREATE INDEX "service_camera_vaults_project_idx" ON "service_camera_vaults" ("project_id");
--> statement-breakpoint
CREATE TABLE "service_camera_vault_viewers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL REFERENCES "stores"("id"),
  "vault_id" uuid NOT NULL REFERENCES "service_camera_vaults"("id") ON DELETE cascade,
  "profile_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE cascade,
  "can_reveal" boolean DEFAULT true NOT NULL,
  "can_copy" boolean DEFAULT false NOT NULL,
  "can_rotate" boolean DEFAULT false NOT NULL,
  "can_manage_viewers" boolean DEFAULT false NOT NULL,
  "granted_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "service_camera_vault_viewers_profile_unique" UNIQUE("vault_id", "profile_id"),
  CONSTRAINT "service_camera_vault_viewers_vault_store_fk" FOREIGN KEY ("store_id", "vault_id") REFERENCES "service_camera_vaults"("store_id", "id") ON DELETE cascade,
  CONSTRAINT "service_camera_vault_viewers_profile_store_fk" FOREIGN KEY ("store_id", "profile_id") REFERENCES "profiles"("store_id", "id") ON DELETE cascade,
  CONSTRAINT "service_camera_vault_viewers_store_id_id_unique" UNIQUE("store_id", "id")
);
--> statement-breakpoint
CREATE INDEX "service_camera_vault_viewers_profile_idx" ON "service_camera_vault_viewers" ("profile_id", "vault_id");
--> statement-breakpoint
DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'service_job_trade_records',
    'service_job_dependencies',
    'service_coordination_points',
    'service_camera_vaults',
    'service_camera_vault_viewers'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tenant_table);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', tenant_table);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', tenant_table);
    END IF;
  END LOOP;
END $$;
