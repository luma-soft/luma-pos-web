ALTER TABLE "media_objects"
  DROP CONSTRAINT "media_objects_purpose_check";--> statement-breakpoint

ALTER TABLE "media_objects"
  ADD CONSTRAINT "media_objects_purpose_check"
  CHECK ("purpose" IN ('product-image','project-document','service-evidence','ai-attachment','library-asset'));--> statement-breakpoint

CREATE TABLE "media_library_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "media_object_id" uuid NOT NULL,
  "album" text DEFAULT 'Chưa phân loại' NOT NULL,
  "title" text NOT NULL,
  "note" text,
  "tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "created_by" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "media_library_items_album_check" CHECK (char_length(btrim("album")) BETWEEN 1 AND 80),
  CONSTRAINT "media_library_items_title_check" CHECK (char_length(btrim("title")) BETWEEN 1 AND 160),
  CONSTRAINT "media_library_items_note_check" CHECK ("note" IS NULL OR char_length("note") <= 500),
  CONSTRAINT "media_library_items_tags_check" CHECK (cardinality("tags") <= 12),
  CONSTRAINT "media_library_items_media_unique" UNIQUE ("store_id","media_object_id"),
  CONSTRAINT "media_library_items_media_tenant_fk" FOREIGN KEY ("store_id","media_object_id")
    REFERENCES "media_objects"("store_id","id") ON DELETE NO ACTION,
  CONSTRAINT "media_library_items_created_by_tenant_fk" FOREIGN KEY ("store_id","created_by")
    REFERENCES "profiles"("store_id","id") ON DELETE NO ACTION
);--> statement-breakpoint

CREATE INDEX "media_library_items_store_album_created_idx"
  ON "media_library_items" ("store_id","album","created_at")
  WHERE "deleted_at" IS NULL;--> statement-breakpoint

CREATE INDEX "media_library_items_store_media_idx"
  ON "media_library_items" ("store_id","media_object_id");--> statement-breakpoint

ALTER TABLE "media_library_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL PRIVILEGES ON TABLE "media_library_items" FROM anon;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "media_library_items" FROM authenticated;--> statement-breakpoint
GRANT SELECT ON TABLE "media_library_items" TO authenticated;--> statement-breakpoint

CREATE POLICY "store_member_select" ON "media_library_items" FOR SELECT TO authenticated
USING (store_id = public.current_active_store_id());--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.guard_ready_library_media_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1
  FROM public.media_objects
  WHERE id = NEW.media_object_id
    AND store_id = NEW.store_id
    AND status = 'ready'
    AND purpose = 'library-asset'
    AND target_id = NEW.store_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEDIA_LIBRARY_REFERENCE_INVALID'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.guard_ready_library_media_reference() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_ready_library_media_reference() FROM anon;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_ready_library_media_reference() FROM authenticated;--> statement-breakpoint

CREATE TRIGGER media_library_items_ready_media_reference
BEFORE INSERT OR UPDATE OF store_id, media_object_id, deleted_at ON public.media_library_items
FOR EACH ROW
WHEN (NEW.deleted_at IS NULL)
EXECUTE FUNCTION public.guard_ready_library_media_reference();
