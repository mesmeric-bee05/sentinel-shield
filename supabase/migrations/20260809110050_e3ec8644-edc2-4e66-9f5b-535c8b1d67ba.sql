CREATE TABLE public.security_export_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  export_kind text NOT NULL,
  format text NOT NULL DEFAULT 'csv',
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  scan_window_from timestamptz,
  scan_window_to timestamptz,
  row_count integer NOT NULL DEFAULT 0,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.security_export_audit TO authenticated;
GRANT ALL ON public.security_export_audit TO service_role;

ALTER TABLE public.security_export_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read export audit"
ON public.security_export_audit
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_security_export_audit_created_at ON public.security_export_audit (created_at DESC);
CREATE INDEX idx_security_export_audit_actor ON public.security_export_audit (actor_id, created_at DESC);