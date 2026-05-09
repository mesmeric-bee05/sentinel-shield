
-- Enums
DO $$ BEGIN
  CREATE TYPE public.facility_type AS ENUM ('clinic','hospital','pharmacy','urgent_care','lab','community_center');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.chw_task_type AS ENUM ('home_visit','medication_check','wellness_call','transport','education','triage_followup');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.chw_priority AS ENUM ('low','normal','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.chw_assignment_status AS ENUM ('pending','accepted','in_progress','completed','cancelled','escalated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== Geo-Intelligence =====
CREATE TABLE IF NOT EXISTS public.care_facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  facility_type public.facility_type NOT NULL DEFAULT 'clinic',
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  address text,
  phone text,
  hours text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_care_facilities_geo ON public.care_facilities (latitude, longitude);

CREATE TABLE IF NOT EXISTS public.service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  center_lat double precision NOT NULL,
  center_lng double precision NOT NULL,
  radius_km numeric NOT NULL DEFAULT 10,
  population_estimate integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.travel_time_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_lat double precision NOT NULL,
  origin_lng double precision NOT NULL,
  dest_lat double precision NOT NULL,
  dest_lng double precision NOT NULL,
  mode text NOT NULL DEFAULT 'driving',
  provider text NOT NULL DEFAULT 'stub',
  duration_seconds integer NOT NULL,
  distance_meters integer NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_travel_cache_lookup ON public.travel_time_cache (origin_lat, origin_lng, dest_lat, dest_lng, mode, provider);

ALTER TABLE public.care_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.travel_time_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone reads facilities" ON public.care_facilities FOR SELECT TO anon, authenticated USING (is_active);
CREATE POLICY "admins manage facilities" ON public.care_facilities FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "anyone reads areas" ON public.service_areas FOR SELECT TO anon, authenticated USING (is_active);
CREATE POLICY "admins manage areas" ON public.service_areas FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "auth reads travel cache" ON public.travel_time_cache FOR SELECT TO authenticated USING (true);
-- Only service_role writes travel_time_cache (no insert/update/delete policies for authenticated)

-- ===== CHW Mesh =====
CREATE TABLE IF NOT EXISTS public.chw_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  display_name text NOT NULL,
  languages text[] NOT NULL DEFAULT ARRAY['en']::text[],
  skills text[] NOT NULL DEFAULT ARRAY[]::text[],
  base_lat double precision,
  base_lng double precision,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chw_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chw_id uuid REFERENCES public.chw_workers(id) ON DELETE SET NULL,
  patient_id uuid NOT NULL,
  task_type public.chw_task_type NOT NULL DEFAULT 'wellness_call',
  priority public.chw_priority NOT NULL DEFAULT 'normal',
  status public.chw_assignment_status NOT NULL DEFAULT 'pending',
  due_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  notes text,
  patient_lat double precision,
  patient_lng double precision,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chw_assign_status ON public.chw_assignments (status, due_at);
CREATE INDEX IF NOT EXISTS idx_chw_assign_chw ON public.chw_assignments (chw_id);

CREATE TABLE IF NOT EXISTS public.chw_check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.chw_assignments(id) ON DELETE CASCADE,
  chw_id uuid NOT NULL REFERENCES public.chw_workers(id) ON DELETE CASCADE,
  status public.chw_assignment_status NOT NULL,
  notes text,
  geo_lat double precision,
  geo_lng double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chw_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chw_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chw_check_ins ENABLE ROW LEVEL SECURITY;

-- chw_workers
CREATE POLICY "admins manage chw workers" ON public.chw_workers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "chw sees own row" ON public.chw_workers FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "chw updates own row" ON public.chw_workers FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "providers read chw" ON public.chw_workers FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'provider'));

-- chw_assignments
CREATE POLICY "admins manage assignments" ON public.chw_assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "chw sees own assignments" ON public.chw_assignments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chw_workers w WHERE w.id = chw_assignments.chw_id AND w.user_id = auth.uid()));
CREATE POLICY "chw updates own assignments" ON public.chw_assignments FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chw_workers w WHERE w.id = chw_assignments.chw_id AND w.user_id = auth.uid()));
CREATE POLICY "providers read assignments" ON public.chw_assignments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'provider'));
CREATE POLICY "patients see own assignments" ON public.chw_assignments FOR SELECT TO authenticated
  USING (patient_id = auth.uid());

-- chw_check_ins
CREATE POLICY "admins manage checkins" ON public.chw_check_ins FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "chw inserts own checkins" ON public.chw_check_ins FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.chw_workers w WHERE w.id = chw_check_ins.chw_id AND w.user_id = auth.uid()));
CREATE POLICY "chw sees own checkins" ON public.chw_check_ins FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chw_workers w WHERE w.id = chw_check_ins.chw_id AND w.user_id = auth.uid()));
CREATE POLICY "providers read checkins" ON public.chw_check_ins FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'provider'));

-- updated_at triggers
DROP TRIGGER IF EXISTS trg_care_facilities_updated ON public.care_facilities;
CREATE TRIGGER trg_care_facilities_updated BEFORE UPDATE ON public.care_facilities
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_chw_assign_updated ON public.chw_assignments;
CREATE TRIGGER trg_chw_assign_updated BEFORE UPDATE ON public.chw_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Seed a few demo facilities so the Geo layer renders meaningful data
INSERT INTO public.care_facilities (name, facility_type, latitude, longitude, address, phone) VALUES
  ('Downtown Community Clinic','clinic',40.7128,-74.0060,'123 Main St, New York, NY','+1-212-555-0100'),
  ('Riverside General Hospital','hospital',40.7589,-73.9851,'456 River Ave, New York, NY','+1-212-555-0200'),
  ('Northside Pharmacy','pharmacy',40.7831,-73.9712,'789 Park Blvd, New York, NY','+1-212-555-0300')
ON CONFLICT DO NOTHING;
