REVOKE EXECUTE ON FUNCTION public.bootstrap_first_admin(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_provider_rating_self_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.rating IS DISTINCT FROM OLD.rating
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'rating can only be changed by administrators'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS providers_guard_rating ON public.providers;
CREATE TRIGGER providers_guard_rating
BEFORE UPDATE ON public.providers
FOR EACH ROW EXECUTE FUNCTION public.prevent_provider_rating_self_change();