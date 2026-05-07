
-- Slot holds
CREATE TABLE public.slot_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_slot_holds_provider_range ON public.slot_holds (provider_id, starts_at, ends_at);
CREATE INDEX idx_slot_holds_expires ON public.slot_holds (expires_at);

ALTER TABLE public.slot_holds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patients see own holds" ON public.slot_holds
  FOR SELECT TO authenticated USING (patient_id = auth.uid());
CREATE POLICY "providers see own holds" ON public.slot_holds
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.providers p WHERE p.id = slot_holds.provider_id AND p.user_id = auth.uid())
  );
CREATE POLICY "admins all holds" ON public.slot_holds
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Cleanup expired
CREATE OR REPLACE FUNCTION public.cleanup_expired_holds()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.slot_holds WHERE expires_at < now();
$$;

-- Acquire hold
CREATE OR REPLACE FUNCTION public.acquire_slot_hold(
  _provider_id uuid, _starts_at timestamptz, _ends_at timestamptz, _ttl_seconds int DEFAULT 180
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id uuid;
  new_exp timestamptz;
  conflict_count int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _ends_at <= _starts_at THEN RAISE EXCEPTION 'invalid range'; END IF;

  PERFORM public.cleanup_expired_holds();
  PERFORM pg_advisory_xact_lock(hashtext(_provider_id::text));

  SELECT count(*) INTO conflict_count FROM public.appointments a
    WHERE a.provider_id = _provider_id
      AND a.status IN ('scheduled','in_progress')
      AND tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(_starts_at, _ends_at, '[)');
  IF conflict_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'appointment_conflict');
  END IF;

  SELECT count(*) INTO conflict_count FROM public.slot_holds h
    WHERE h.provider_id = _provider_id
      AND h.expires_at > now()
      AND h.patient_id <> auth.uid()
      AND tstzrange(h.starts_at, h.ends_at, '[)') && tstzrange(_starts_at, _ends_at, '[)');
  IF conflict_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'hold_conflict');
  END IF;

  -- Replace any existing hold by same patient on same provider range
  DELETE FROM public.slot_holds WHERE patient_id = auth.uid() AND provider_id = _provider_id;

  new_exp := now() + make_interval(secs => _ttl_seconds);
  INSERT INTO public.slot_holds (provider_id, patient_id, starts_at, ends_at, expires_at)
  VALUES (_provider_id, auth.uid(), _starts_at, _ends_at, new_exp)
  RETURNING id INTO new_id;

  INSERT INTO public.audit_events (actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), 'hold.acquired', 'slot_holds', new_id,
          jsonb_build_object('provider_id', _provider_id, 'starts_at', _starts_at, 'ends_at', _ends_at));

  RETURN jsonb_build_object('ok', true, 'hold_id', new_id, 'expires_at', new_exp);
END $$;

CREATE OR REPLACE FUNCTION public.release_slot_hold(_hold_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE deleted int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  DELETE FROM public.slot_holds WHERE id = _hold_id AND patient_id = auth.uid();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted > 0;
END $$;

REVOKE ALL ON FUNCTION public.acquire_slot_hold(uuid, timestamptz, timestamptz, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_slot_hold(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_expired_holds() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acquire_slot_hold(uuid, timestamptz, timestamptz, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_slot_hold(uuid) TO authenticated;

-- SMS opt-in on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_e164 text,
  ADD COLUMN IF NOT EXISTS sms_opt_in boolean NOT NULL DEFAULT false;
