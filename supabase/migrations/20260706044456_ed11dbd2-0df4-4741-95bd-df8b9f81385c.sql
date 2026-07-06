-- Tighten provider_availability public read to only active providers
DROP POLICY IF EXISTS "anyone views availability" ON public.provider_availability;
CREATE POLICY "anyone views availability of active providers"
  ON public.provider_availability
  FOR SELECT
  TO public
  USING (EXISTS (SELECT 1 FROM public.providers p WHERE p.id = provider_availability.provider_id AND p.is_active = true));

-- Restrict travel_time_cache reads to admins (server code uses service role and bypasses RLS)
DROP POLICY IF EXISTS "auth reads travel cache" ON public.travel_time_cache;
CREATE POLICY "admins read travel cache"
  ON public.travel_time_cache
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));