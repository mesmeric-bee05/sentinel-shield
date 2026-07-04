
CREATE TABLE public.security_sync_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  source_ip text,
  nonce text,
  signature_valid boolean NOT NULL,
  payload_bytes int,
  finding_count int,
  status text NOT NULL CHECK (status IN
    ('accepted','invalid_signature','invalid_payload','replay','disabled','write_failed')),
  error text,
  duration_ms int
);

GRANT SELECT, INSERT ON public.security_sync_attempts TO service_role;

ALTER TABLE public.security_sync_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read sync attempts"
  ON public.security_sync_attempts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX security_sync_attempts_received_idx
  ON public.security_sync_attempts (received_at DESC);

CREATE UNIQUE INDEX security_sync_attempts_nonce_key
  ON public.security_sync_attempts (nonce) WHERE nonce IS NOT NULL;
