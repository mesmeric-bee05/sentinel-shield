
CREATE INDEX IF NOT EXISTS idx_ssa_source_ip_received_at
  ON public.security_sync_attempts (source_ip, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ssa_received_at
  ON public.security_sync_attempts (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ssa_status_received_at
  ON public.security_sync_attempts (status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_crl_created_at
  ON public.chw_requeue_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crl_assignment_id
  ON public.chw_requeue_log (assignment_id);
CREATE INDEX IF NOT EXISTS idx_crl_actor_id_created_at
  ON public.chw_requeue_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crl_scope_created_at
  ON public.chw_requeue_log (scope, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sfa_created_at
  ON public.security_finding_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sfa_internal_id
  ON public.security_finding_audit (internal_id);
CREATE INDEX IF NOT EXISTS idx_sfa_resolution
  ON public.security_finding_audit (resolution);
