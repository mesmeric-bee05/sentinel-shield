
CREATE TABLE public.gsc_republish_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  status text NOT NULL,
  http_status integer,
  error_message text,
  duration_ms integer,
  site_url text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.gsc_republish_log TO authenticated;
GRANT ALL ON public.gsc_republish_log TO service_role;
ALTER TABLE public.gsc_republish_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read gsc history"
  ON public.gsc_republish_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.seo_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  duration_ms integer NOT NULL,
  summary jsonb NOT NULL,
  checks jsonb NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.seo_audit_runs TO authenticated;
GRANT ALL ON public.seo_audit_runs TO service_role;
ALTER TABLE public.seo_audit_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read seo runs"
  ON public.seo_audit_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.email_settings
  ADD COLUMN IF NOT EXISTS last_dns_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS live_since_at timestamptz;
