CREATE OR REPLACE FUNCTION public.is_valid_ai_attachment_document(document jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
    WHEN document IS NULL THEN true
    WHEN jsonb_typeof(document) <> 'array' THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(document) = 'array' THEN document ELSE '[]'::jsonb END
      ) element
      WHERE jsonb_typeof(element) <> 'object'
         OR (
           element ? 'mediaId'
           AND (
             jsonb_typeof(element->'mediaId') <> 'string'
             OR element->>'mediaId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           )
         )
    )
  END
$$;--> statement-breakpoint

ALTER TABLE public.ai_chat_messages
  ADD CONSTRAINT ai_chat_messages_attachments_shape_check
  CHECK (public.is_valid_ai_attachment_document(attachments)) NOT VALID;--> statement-breakpoint

ALTER TABLE public.ai_chat_messages
  ADD CONSTRAINT ai_chat_messages_session_tenant_fk
  FOREIGN KEY (store_id, session_id)
  REFERENCES public.ai_chat_sessions(store_id, id)
  ON DELETE CASCADE
  NOT VALID;--> statement-breakpoint

ALTER TABLE public.service_signatures
  ADD CONSTRAINT service_signatures_attachment_tenant_fk
  FOREIGN KEY (store_id, attachment_id)
  REFERENCES public.service_attachments(store_id, id)
  ON DELETE RESTRICT
  NOT VALID;--> statement-breakpoint

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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEDIA_SIGNATURE_ATTACHMENT_TENANT_MISMATCH'
      USING ERRCODE = '23514';
  END IF;
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

DROP TRIGGER service_signatures_ready_media_reference ON public.service_signatures;--> statement-breakpoint

CREATE TRIGGER service_signatures_ready_media_reference
BEFORE INSERT OR UPDATE OF attachment_id, invalidated_at, store_id ON public.service_signatures
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
  IF NOT public.is_valid_ai_attachment_document(NEW.attachments) THEN
    RAISE EXCEPTION 'MEDIA_AI_ATTACHMENTS_INVALID'
      USING ERRCODE = '23514';
  END IF;

  FOR referenced_media_id IN
    SELECT DISTINCT (element->>'mediaId')::uuid
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(NEW.attachments) = 'array'
        THEN NEW.attachments ELSE '[]'::jsonb END
    ) element
    WHERE jsonb_typeof(element) = 'object'
      AND jsonb_typeof(element->'mediaId') = 'string'
      AND element->>'mediaId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
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

DROP TRIGGER ai_chat_messages_ready_media_references ON public.ai_chat_messages;--> statement-breakpoint

CREATE TRIGGER ai_chat_messages_ready_media_references
BEFORE INSERT OR UPDATE OF attachments, store_id ON public.ai_chat_messages
FOR EACH ROW
WHEN (NEW.attachments IS NOT NULL)
EXECUTE FUNCTION public.guard_ready_ai_media_references();
