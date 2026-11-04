CREATE TABLE public.admin_alert_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  alert_email text NOT NULL DEFAULT 'alvo4breezy@gmail.com',
  spike_window_minutes integer NOT NULL DEFAULT 15 CHECK (spike_window_minutes BETWEEN 1 AND 1440),
  spike_threshold integer NOT NULL DEFAULT 5 CHECK (spike_threshold BETWEEN 1 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.admin_alert_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.admin_alert_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read alert settings"
  ON public.admin_alert_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins update alert settings"
  ON public.admin_alert_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, UPDATE ON public.admin_alert_settings TO authenticated;
GRANT ALL ON public.admin_alert_settings TO service_role;