CREATE OR REPLACE VIEW public.security_sync_metrics_daily AS
SELECT
  date_trunc('day', received_at) AS day,
  status,
  count(*)::int AS count,
  sum(payload_bytes)::bigint AS bytes,
  avg(duration_ms)::int AS avg_duration_ms,
  max(received_at) AS last_seen
FROM public.security_sync_attempts
GROUP BY 1, 2;

REVOKE ALL ON public.security_sync_metrics_daily FROM PUBLIC;
GRANT SELECT ON public.security_sync_metrics_daily TO service_role;