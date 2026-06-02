
CREATE TABLE public.email_settings (
  id int PRIMARY KEY DEFAULT 1,
  delivery_mode text NOT NULL DEFAULT 'sandbox' CHECK (delivery_mode IN ('sandbox','live')),
  sender_domain text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_settings_singleton CHECK (id = 1)
);
GRANT SELECT ON public.email_settings TO authenticated;
GRANT ALL ON public.email_settings TO service_role;
ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view email settings" ON public.email_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
INSERT INTO public.email_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE public.seo_settings (
  id int PRIMARY KEY DEFAULT 1,
  gsc_meta_token text,
  gsc_site_url text,
  gsc_verified_at timestamptz,
  gsc_sitemap_submitted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_settings_singleton CHECK (id = 1)
);
GRANT SELECT ON public.seo_settings TO anon, authenticated;
GRANT ALL ON public.seo_settings TO service_role;
ALTER TABLE public.seo_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read seo settings (token is public meta tag)" ON public.seo_settings FOR SELECT USING (true);
INSERT INTO public.seo_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
