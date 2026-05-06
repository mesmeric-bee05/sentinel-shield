
REVOKE EXECUTE ON FUNCTION public.bootstrap_first_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_count() FROM anon;
REVOKE EXECUTE ON FUNCTION public.grant_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decide_role_request(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_audit(text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit(text, text, uuid, jsonb) TO authenticated;
-- grant_role / revoke_role / decide_role_request: only callable via service role from server fns
