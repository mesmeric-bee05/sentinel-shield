CREATE TABLE public.security_export_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dataset text NOT NULL,
  format text NOT NULL DEFAULT 'csv',
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  scan_window_from timestamptz,
  scan_window_to timestamptz,
  status text NOT NULL DEFAULT 'queued',
  progress_rows integer NOT NULL DEFAULT 0,
  total_rows integer,
  result_payload text,
  result_bytes integer,
  error text,
  correlation_id text,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.security_export_jobs TO authenticated;
GRANT ALL ON public.security_export_jobs TO service_role;

ALTER TABLE public.security_export_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view export jobs"
ON public.security_export_jobs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_security_export_jobs_updated
BEFORE UPDATE ON public.security_export_jobs
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_security_export_jobs_created ON public.security_export_jobs (created_at DESC);
CREATE INDEX idx_security_export_jobs_requester ON public.security_export_jobs (requested_by, created_at DESC);

ALTER TABLE public.security_export_audit ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE public.security_sync_attempts ADD COLUMN IF NOT EXISTS correlation_id text;

CREATE INDEX IF NOT EXISTS idx_security_export_audit_actor ON public.security_export_audit (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_export_audit_kind ON public.security_export_audit (export_kind, created_at DESC);