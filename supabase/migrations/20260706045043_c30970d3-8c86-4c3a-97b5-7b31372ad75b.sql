-- Audit log for security-finding fixes / ignores.
CREATE TABLE IF NOT EXISTS public.security_finding_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_id text NOT NULL,
  scanner_name text NOT NULL,
  resolution text NOT NULL CHECK (resolution IN ('fixed','ignored','reintroduced')),
  affected_endpoints text[] NOT NULL DEFAULT ARRAY[]::text[],
  affected_queries  text[] NOT NULL DEFAULT ARRAY[]::text[],
  notes text,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_finding_audit_internal ON public.security_finding_audit (internal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_finding_audit_created ON public.security_finding_audit (created_at DESC);

GRANT SELECT ON public.security_finding_audit TO authenticated;
GRANT ALL ON public.security_finding_audit TO service_role;

ALTER TABLE public.security_finding_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read finding audit"
  ON public.security_finding_audit
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- No INSERT policy: writes go through service role or the SECURITY DEFINER RPC below.

CREATE OR REPLACE FUNCTION public.log_security_fix(
  _internal_id text,
  _scanner_name text,
  _resolution text,
  _affected_endpoints text[],
  _affected_queries text[],
  _notes text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _resolution NOT IN ('fixed','ignored','reintroduced') THEN
    RAISE EXCEPTION 'invalid resolution: %', _resolution;
  END IF;
  INSERT INTO public.security_finding_audit
    (internal_id, scanner_name, resolution, affected_endpoints, affected_queries, notes, resolved_by)
  VALUES
    (_internal_id, _scanner_name, _resolution,
     COALESCE(_affected_endpoints, ARRAY[]::text[]),
     COALESCE(_affected_queries, ARRAY[]::text[]),
     _notes, auth.uid())
  RETURNING id INTO new_id;

  INSERT INTO public.audit_events (actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), 'security.finding_' || _resolution, 'security_finding_audit', new_id,
          jsonb_build_object('internal_id', _internal_id, 'scanner_name', _scanner_name));
  RETURN new_id;
END $$;

REVOKE ALL ON FUNCTION public.log_security_fix(text,text,text,text[],text[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_security_fix(text,text,text,text[],text[],text) TO authenticated;

-- Backfill entries for the three findings already fixed in earlier turns.
INSERT INTO public.security_finding_audit
  (internal_id, scanner_name, resolution, affected_endpoints, affected_queries, notes)
VALUES
  ('seo_settings_unauthed', 'agent_security', 'fixed',
   ARRAY['getSeoSettings'],
   ARRAY[]::text[],
   'Added requireSupabaseAuth middleware and admin has_role check; non-admins receive {settings:null, error:"Forbidden"}.'),
  ('provider_availability_public_read', 'supabase_lov', 'fixed',
   ARRAY[]::text[],
   ARRAY['provider_availability SELECT (public role)'],
   'Replaced USING(true) policy with EXISTS(providers WHERE id=provider_id AND is_active=true).'),
  ('travel_time_cache_broad_authenticated_read', 'supabase_lov', 'fixed',
   ARRAY[]::text[],
   ARRAY['travel_time_cache SELECT (authenticated role)'],
   'Dropped broad "auth reads travel cache" policy; replaced with admin-only. Server-side writes continue via service role.');