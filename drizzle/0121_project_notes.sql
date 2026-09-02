CREATE TABLE "project_notes" (
  "store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE cascade,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "content" text NOT NULL,
  "created_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "project_notes_content_check"
    CHECK (char_length(btrim("content")) > 0),
  CONSTRAINT "project_notes_store_id_id_unique" UNIQUE("store_id", "id"),
  CONSTRAINT "project_notes_project_tenant_fk"
    FOREIGN KEY ("store_id", "project_id")
    REFERENCES "projects"("store_id", "id") ON DELETE cascade,
  CONSTRAINT "project_notes_created_by_tenant_fk"
    FOREIGN KEY ("store_id", "created_by")
    REFERENCES "profiles"("store_id", "id") ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX "project_notes_project_updated_idx"
  ON "project_notes" ("store_id", "project_id", "updated_at" DESC);
--> statement-breakpoint
-- Preserve legacy notes in full; the API caps new/edited notes at 5000 characters.
INSERT INTO "project_notes" (
  "store_id",
  "project_id",
  "content",
  "created_at",
  "updated_at"
)
SELECT
  "store_id",
  "id",
  btrim("note"),
  "created_at",
  "created_at"
FROM "projects"
WHERE "note" IS NOT NULL
  AND btrim("note") <> '';
--> statement-breakpoint
ALTER TABLE "project_notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "project_notes" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE "project_notes" FROM authenticated;
GRANT SELECT ON TABLE "project_notes" TO authenticated;
--> statement-breakpoint
CREATE POLICY project_notes_store_member_select
  ON "project_notes"
  FOR SELECT
  TO authenticated
  USING (store_id = public.current_active_store_id());
