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

CREATE OR REPLACE FUNCTION public.sync_relay_memberships_from_store()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.sync_relay_memberships m
  SET is_active = p.is_active AND NEW.status = 'active',
      updated_at = now()
  FROM public.profiles p
  WHERE p.id = m.user_id
    AND p.store_id = NEW.id
    AND m.store_id = NEW.id;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.sync_relay_memberships_from_store() FROM PUBLIC;

DROP TRIGGER IF EXISTS sync_relay_membership_profile_write ON public.profiles;
CREATE TRIGGER sync_relay_membership_profile_write
AFTER INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_relay_membership_from_profile();

DROP TRIGGER IF EXISTS sync_relay_membership_profile_delete ON public.profiles;
CREATE TRIGGER sync_relay_membership_profile_delete
AFTER DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_relay_membership_from_profile();

DROP TRIGGER IF EXISTS sync_relay_membership_store_status ON public.stores;
CREATE TRIGGER sync_relay_membership_store_status
AFTER UPDATE OF status ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.sync_relay_memberships_from_store();

INSERT INTO public.sync_relay_memberships (store_id, user_id, role, is_active, updated_at)
SELECT p.store_id, p.id, p.role::text, p.is_active AND s.status = 'active', now()
FROM public.profiles p
JOIN public.stores s ON s.id = p.store_id
ON CONFLICT (store_id, user_id) DO UPDATE
SET role = EXCLUDED.role,
    is_active = EXCLUDED.is_active,
    updated_at = EXCLUDED.updated_at;
