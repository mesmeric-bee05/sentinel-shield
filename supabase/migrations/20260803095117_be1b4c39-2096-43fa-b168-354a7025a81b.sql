ALTER VIEW public.security_sync_metrics_daily SET (security_invoker = on);

REVOKE ALL ON FUNCTION public.log_security_fix(text, text, text, text[], text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_security_fix(text, text, text, text[], text[], text) FROM anon;
GRANT EXECUTE ON FUNCTION public.log_security_fix(text, text, text, text[], text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_security_fix(text, text, text, text[], text[], text) TO service_role;