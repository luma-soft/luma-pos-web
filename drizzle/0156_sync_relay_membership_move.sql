CREATE OR REPLACE FUNCTION public.sync_relay_membership_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  store_is_active boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.sync_relay_memberships
    WHERE store_id = OLD.store_id AND user_id = OLD.id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.store_id IS DISTINCT FROM NEW.store_id THEN
    DELETE FROM public.sync_relay_memberships
    WHERE store_id = OLD.store_id AND user_id = OLD.id;
  END IF;

  SELECT s.status = 'active'
  INTO store_is_active
  FROM public.stores s
  WHERE s.id = NEW.store_id;

  INSERT INTO public.sync_relay_memberships (store_id, user_id, role, is_active, updated_at)
  VALUES (
    NEW.store_id,
    NEW.id,
    NEW.role::text,
    NEW.is_active AND coalesce(store_is_active, false),
    now()
  )
  ON CONFLICT (store_id, user_id) DO UPDATE
  SET role = EXCLUDED.role,
      is_active = EXCLUDED.is_active,
      updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.sync_relay_membership_from_profile() FROM PUBLIC;
