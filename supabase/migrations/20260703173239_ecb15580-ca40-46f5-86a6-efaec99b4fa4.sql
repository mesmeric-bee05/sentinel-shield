
-- Security findings tracker
CREATE TABLE public.security_findings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scanner_name TEXT NOT NULL,
  internal_id TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('error','warn','info')),
  resource TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','fixed','ignored')),
  rationale TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scanner_name, internal_id)
);
GRANT SELECT ON public.security_findings TO authenticated;
GRANT ALL ON public.security_findings TO service_role;
ALTER TABLE public.security_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read security findings" ON public.security_findings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_security_findings_updated
  BEFORE UPDATE ON public.security_findings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- CHW re-queue audit log
CREATE TABLE public.chw_requeue_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id UUID NOT NULL REFERENCES public.chw_assignments(id) ON DELETE CASCADE,
  previous_status TEXT NOT NULL,
  retry_count INT NOT NULL,
  actor_id UUID NOT NULL,
  scope TEXT NOT NULL DEFAULT 'single',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.chw_requeue_log TO authenticated;
GRANT ALL ON public.chw_requeue_log TO service_role;
ALTER TABLE public.chw_requeue_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read requeue log" ON public.chw_requeue_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE INDEX idx_chw_requeue_log_assignment ON public.chw_requeue_log(assignment_id, created_at DESC);

-- Seed accepted-risk findings
INSERT INTO public.security_findings (scanner_name, internal_id, title, severity, resource, status, rationale) VALUES
  ('supabase_lov','care_facilities_phone_public','Care facility phone numbers publicly exposed','warn','public.care_facilities','ignored','Intentional: public-facing clinic directory number. See docs/security/accepted-risks.md §1.'),
  ('supabase','SUPA_authenticated_security_definer_function_executable','Signed-in users can execute SECURITY DEFINER functions','warn','public.has_role, acquire_slot_hold, ...','ignored','All functions self-authorize. Revoking EXECUTE would break RLS evaluation. See docs/security/accepted-risks.md §2.')
ON CONFLICT (scanner_name, internal_id) DO NOTHING;
