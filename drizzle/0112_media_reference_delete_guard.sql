CREATE OR REPLACE FUNCTION public.guard_ready_media_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  referenced_media_id uuid;
  referenced_store_id uuid;
BEGIN
  referenced_media_id := NULLIF(to_jsonb(NEW)->>TG_ARGV[0], '')::uuid;
  referenced_store_id := NULLIF(to_jsonb(NEW)->>'store_id', '')::uuid;
  IF referenced_media_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM public.media_objects
  WHERE id = referenced_media_id
    AND store_id = referenced_store_id
    AND status = 'ready'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEDIA_REFERENCE_NOT_READY'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER brands_ready_media_reference
BEFORE INSERT OR UPDATE OF logo_media_object_id ON public.brands
FOR EACH ROW
WHEN (NEW.logo_media_object_id IS NOT NULL)
EXECUTE FUNCTION public.guard_ready_media_reference('logo_media_object_id');--> statement-breakpoint

CREATE TRIGGER product_media_ready_media_reference
BEFORE INSERT OR UPDATE OF media_object_id, deleted_at ON public.product_media
FOR EACH ROW
WHEN (NEW.media_object_id IS NOT NULL AND NEW.deleted_at IS NULL)
EXECUTE FUNCTION public.guard_ready_media_reference('media_object_id');--> statement-breakpoint

CREATE TRIGGER service_attachments_ready_media_reference
BEFORE INSERT OR UPDATE OF media_object_id, deleted_at ON public.service_attachments
FOR EACH ROW
WHEN (NEW.media_object_id IS NOT NULL AND NEW.deleted_at IS NULL)
EXECUTE FUNCTION public.guard_ready_media_reference('media_object_id');--> statement-breakpoint

CREATE TRIGGER service_customer_request_attachments_ready_media_reference
BEFORE INSERT OR UPDATE OF media_object_id ON public.service_customer_request_attachments
FOR EACH ROW
WHEN (NEW.media_object_id IS NOT NULL)
EXECUTE FUNCTION public.guard_ready_media_reference('media_object_id');--> statement-breakpoint

CREATE TRIGGER service_handover_document_media_ready_media_reference
BEFORE INSERT OR UPDATE OF media_object_id ON public.service_handover_document_media
FOR EACH ROW
WHEN (NEW.media_object_id IS NOT NULL)
EXECUTE FUNCTION public.guard_ready_media_reference('media_object_id');--> statement-breakpoint

CREATE TRIGGER media_migration_items_ready_media_reference
BEFORE INSERT OR UPDATE OF media_object_id, status ON public.media_migration_items
FOR EACH ROW
WHEN (NEW.media_object_id IS NOT NULL AND NEW.status <> 'rolled_back')
EXECUTE FUNCTION public.guard_ready_media_reference('media_object_id');--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.guard_ready_signature_media_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  referenced_media_id uuid;
BEGIN
  SELECT attachment.media_object_id
  INTO referenced_media_id
  FROM public.service_attachments attachment
  WHERE attachment.id = NEW.attachment_id
    AND attachment.store_id = NEW.store_id;

  IF referenced_media_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM public.media_objects
  WHERE id = referenced_media_id
    AND store_id = NEW.store_id
    AND status = 'ready'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEDIA_REFERENCE_NOT_READY'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER service_signatures_ready_media_reference
BEFORE INSERT OR UPDATE OF attachment_id, invalidated_at ON public.service_signatures
FOR EACH ROW
WHEN (NEW.invalidated_at IS NULL)
EXECUTE FUNCTION public.guard_ready_signature_media_reference();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.guard_ready_ai_media_references()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  referenced_media_id uuid;
BEGIN
  FOR referenced_media_id IN
    SELECT NULLIF(attachment->>'mediaId', '')::uuid
    FROM jsonb_array_elements(COALESCE(NEW.attachments, '[]'::jsonb)) attachment
    WHERE attachment ? 'mediaId'
  LOOP
    PERFORM 1
    FROM public.media_objects
    WHERE id = referenced_media_id
      AND store_id = NEW.store_id
      AND status = 'ready'
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'MEDIA_REFERENCE_NOT_READY'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER ai_chat_messages_ready_media_references
BEFORE INSERT OR UPDATE OF attachments ON public.ai_chat_messages
FOR EACH ROW
WHEN (NEW.attachments IS NOT NULL)
EXECUTE FUNCTION public.guard_ready_ai_media_references();
