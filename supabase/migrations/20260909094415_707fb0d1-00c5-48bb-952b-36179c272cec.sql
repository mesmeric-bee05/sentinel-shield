CREATE TABLE IF NOT EXISTS public.security_export_filter_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  dataset text,
  actor_filter text,
  status_filter text,
  search text,
  scan_window_from text,
  scan_window_to text,
  date_from text,
  date_to text,
  is_shared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_export_filter_presets_owner_name_key UNIQUE (owner_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_export_filter_presets TO authenticated;
GRANT ALL ON public.security_export_filter_presets TO service_role;
ALTER TABLE public.security_export_filter_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read own or shared presets"
  ON public.security_export_filter_presets FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND (owner_id = auth.uid() OR is_shared));
CREATE POLICY "Admins create own presets"
  ON public.security_export_filter_presets FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND owner_id = auth.uid());
CREATE POLICY "Admins update own presets"
  ON public.security_export_filter_presets FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Admins delete own presets"
  ON public.security_export_filter_presets FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS security_export_filter_presets_owner_idx
  ON public.security_export_filter_presets (owner_id, name);

CREATE TABLE IF NOT EXISTS public.security_retention_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset text NOT NULL UNIQUE,
  retention_days integer NOT NULL DEFAULT 180,
  payload_retention_days integer NOT NULL DEFAULT 7,
  last_run_at timestamptz,
  last_deleted_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.security_retention_settings TO authenticated;
GRANT ALL ON public.security_retention_settings TO service_role;
ALTER TABLE public.security_retention_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read retention settings"
  ON public.security_retention_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins write retention settings"
  ON public.security_retention_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins edit retention settings"
  ON public.security_retention_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.security_retention_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset text NOT NULL,
  deleted_rows integer NOT NULL DEFAULT 0,
  cleared_payloads integer NOT NULL DEFAULT 0,
  duration_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.security_retention_runs TO authenticated;
GRANT ALL ON public.security_retention_runs TO service_role;
ALTER TABLE public.security_retention_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read retention runs"
  ON public.security_retention_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS security_retention_runs_created_idx
  ON public.security_retention_runs (created_at DESC);

ALTER TABLE public.security_export_jobs
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS attempt_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS download_token_hash text,
  ADD COLUMN IF NOT EXISTS download_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS download_consumed_at timestamptz;

INSERT INTO public.security_retention_settings (dataset, retention_days, payload_retention_days)
VALUES ('security_export_audit', 180, 7), ('security_export_jobs', 90, 7)
ON CONFLICT (dataset) DO NOTHING;

CREATE TRIGGER update_security_export_filter_presets_updated_at
  BEFORE UPDATE ON public.security_export_filter_presets
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER update_security_retention_settings_updated_at
  BEFORE UPDATE ON public.security_retention_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();