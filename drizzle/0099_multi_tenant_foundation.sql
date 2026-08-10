CREATE TYPE "store_status" AS ENUM ('active', 'suspended', 'archived');
--> statement-breakpoint
CREATE TABLE "stores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "status" "store_status" DEFAULT 'active' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "stores_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
INSERT INTO "stores" ("id", "slug", "status")
VALUES ('00000000-0000-4000-8000-000000000001', 'hai-dang', 'active')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "profiles"
  ADD COLUMN "store_id" uuid NOT NULL
  DEFAULT '00000000-0000-4000-8000-000000000001';
--> statement-breakpoint
ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_store_id_stores_id_fk"
  FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");
--> statement-breakpoint
CREATE INDEX "profiles_store_active_role_idx"
  ON "profiles" ("store_id", "is_active", "role");
--> statement-breakpoint
ALTER TABLE "store_settings"
  ADD COLUMN "store_id" uuid NOT NULL
  DEFAULT '00000000-0000-4000-8000-000000000001';
--> statement-breakpoint
ALTER TABLE "store_settings"
  ADD CONSTRAINT "store_settings_store_id_stores_id_fk"
  FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "store_settings_store_idx"
  ON "store_settings" ("store_id");
--> statement-breakpoint
ALTER TABLE "catalog_sync_state"
  ADD COLUMN "store_id" uuid NOT NULL
  DEFAULT '00000000-0000-4000-8000-000000000001';
--> statement-breakpoint
ALTER TABLE "catalog_sync_state"
  ADD CONSTRAINT "catalog_sync_state_store_id_stores_id_fk"
  FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "catalog_sync_state"
  DROP CONSTRAINT "catalog_sync_state_pkey";
--> statement-breakpoint
ALTER TABLE "catalog_sync_state"
  ADD CONSTRAINT "catalog_sync_state_store_id_id_pk"
  PRIMARY KEY ("store_id", "id");
--> statement-breakpoint
CREATE TABLE "store_features" (
  "store_id" uuid NOT NULL,
  "feature_key" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_by" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "store_features_store_id_feature_key_pk"
    PRIMARY KEY ("store_id", "feature_key"),
  CONSTRAINT "store_features_store_id_stores_id_fk"
    FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade,
  CONSTRAINT "store_features_updated_by_profiles_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX "store_features_enabled_idx"
  ON "store_features" ("store_id", "enabled");
--> statement-breakpoint
INSERT INTO "store_features" ("store_id", "feature_key", "enabled")
SELECT
  '00000000-0000-4000-8000-000000000001'::uuid,
  feature_key,
  true
FROM unnest(ARRAY[
  'camera_quote_builder',
  'camera_price_list',
  'hunonic_price_list',
  'rang_dong_price_list',
  'field_services',
  'online_sales',
  'ai_assistant',
  'einvoice'
]) AS feature_key
ON CONFLICT ("store_id", "feature_key") DO UPDATE
SET "enabled" = EXCLUDED."enabled", "updated_at" = now();
--> statement-breakpoint
CREATE TABLE "staff_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "email" text,
  "phone_normalized" text,
  "role" "user_role" NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "invited_by" uuid NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "staff_invitations_token_hash_unique" UNIQUE("token_hash"),
  CONSTRAINT "staff_invitations_store_id_stores_id_fk"
    FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade,
  CONSTRAINT "staff_invitations_invited_by_profiles_id_fk"
    FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id"),
  CONSTRAINT "staff_invitations_contact_check"
    CHECK ("email" IS NOT NULL OR "phone_normalized" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX "staff_invitations_store_created_idx"
  ON "staff_invitations" ("store_id", "created_at");
--> statement-breakpoint
CREATE INDEX "staff_invitations_store_email_idx"
  ON "staff_invitations" ("store_id", "email");
--> statement-breakpoint
DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['stores', 'store_features', 'staff_invitations']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tenant_table);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', tenant_table);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', tenant_table);
    END IF;
  END LOOP;
END
$$;
