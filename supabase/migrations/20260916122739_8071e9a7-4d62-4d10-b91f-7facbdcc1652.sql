ALTER TABLE public.security_export_jobs ADD COLUMN IF NOT EXISTS notify_email text;
ALTER TABLE public.security_export_jobs ADD COLUMN IF NOT EXISTS notified_at timestamptz;