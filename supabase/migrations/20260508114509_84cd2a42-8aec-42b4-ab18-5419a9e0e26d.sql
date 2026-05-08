-- 1) Tighten EXECUTE permissions on every SECURITY DEFINER function.
-- Default Postgres grants EXECUTE to PUBLIC; we revoke and re-grant explicitly.

-- Helpers callable by any authenticated user
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_count() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.log_audit(text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_audit(text, text, uuid, jsonb) TO authenticated, service_role;

-- Slot holds: only authenticated patients
REVOKE ALL ON FUNCTION public.acquire_slot_hold(uuid, timestamptz, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acquire_slot_hold(uuid, timestamptz, timestamptz, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.release_slot_hold(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_slot_hold(uuid) TO authenticated;

-- Maintenance: service-role / cron only, never end-users
REVOKE ALL ON FUNCTION public.cleanup_expired_holds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_holds() TO service_role;

-- Bootstrap admin: signed-in only (function itself enforces "only when no admins exist")
REVOKE ALL ON FUNCTION public.bootstrap_first_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin(uuid) TO authenticated;

-- Role management: signed-in only (function enforces admin role check internally)
REVOKE ALL ON FUNCTION public.grant_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_role(uuid, public.app_role) TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_role(uuid, public.app_role) TO authenticated;

REVOKE ALL ON FUNCTION public.decide_role_request(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_role_request(uuid, boolean) TO authenticated;

-- Trigger fns: keep restricted; auth schema invokes via owner
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;

-- 2) Performance index for the cleanup hot path
CREATE INDEX IF NOT EXISTS idx_slot_holds_provider_expires
  ON public.slot_holds (provider_id, expires_at);

-- 3) Schedule cleanup_expired_holds via pg_cron (every minute)
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-expired-slot-holds') THEN
    PERFORM cron.unschedule('cleanup-expired-slot-holds');
  END IF;
END $$;

SELECT cron.schedule(
  'cleanup-expired-slot-holds',
  '* * * * *',
  $$ SELECT public.cleanup_expired_holds(); $$
);
