ALTER TABLE public.security_sync_attempts DROP CONSTRAINT IF EXISTS security_sync_attempts_status_check;
ALTER TABLE public.security_sync_attempts ADD CONSTRAINT security_sync_attempts_status_check
  CHECK (status = ANY (ARRAY['accepted','invalid_signature','invalid_payload','replay','disabled','write_failed','payload_too_large','rate_limited']));