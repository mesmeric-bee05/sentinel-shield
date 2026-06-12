
-- 1) profiles: scope provider read to their own patients
DROP POLICY IF EXISTS "providers view patient profiles" ON public.profiles;
CREATE POLICY "providers view their patients profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'provider'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.appointments a
      JOIN public.providers p ON p.id = a.provider_id
      WHERE p.user_id = auth.uid() AND a.patient_id = profiles.id
    )
  );

-- 2) chw_assignments: scope provider read to their patients
DROP POLICY IF EXISTS "providers read assignments" ON public.chw_assignments;
CREATE POLICY "providers read assignments for their patients" ON public.chw_assignments
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'provider'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.appointments a
      JOIN public.providers p ON p.id = a.provider_id
      WHERE p.user_id = auth.uid() AND a.patient_id = chw_assignments.patient_id
    )
  );

-- 3) chw_check_ins: scope provider read to check-ins for their patients
DROP POLICY IF EXISTS "providers read checkins" ON public.chw_check_ins;
CREATE POLICY "providers read checkins for their patients" ON public.chw_check_ins
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'provider'::app_role)
    AND EXISTS (
      SELECT 1
      FROM public.chw_assignments ca
      JOIN public.appointments a ON a.patient_id = ca.patient_id
      JOIN public.providers p ON p.id = a.provider_id
      WHERE ca.id = chw_check_ins.assignment_id AND p.user_id = auth.uid()
    )
  );

-- 4) chw_workers: scope provider read to workers assigned to their patients
DROP POLICY IF EXISTS "providers read chw" ON public.chw_workers;
CREATE POLICY "providers read chw for their patients" ON public.chw_workers
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'provider'::app_role)
    AND EXISTS (
      SELECT 1
      FROM public.chw_assignments ca
      JOIN public.appointments a ON a.patient_id = ca.patient_id
      JOIN public.providers p ON p.id = a.provider_id
      WHERE ca.chw_id = chw_workers.id AND p.user_id = auth.uid()
    )
  );

-- 5) seo_settings: remove public read, restrict to admins only
DROP POLICY IF EXISTS "Anyone can read seo settings (token is public meta tag)" ON public.seo_settings;
CREATE POLICY "admins read seo settings" ON public.seo_settings
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 6) Remove chw_assignments from realtime publication to block unauthorized channel subscriptions
ALTER PUBLICATION supabase_realtime DROP TABLE public.chw_assignments;
