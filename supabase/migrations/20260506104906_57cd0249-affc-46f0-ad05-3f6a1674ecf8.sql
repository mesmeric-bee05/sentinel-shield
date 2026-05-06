
-- role_requests table
CREATE TYPE public.role_request_status AS ENUM ('pending','approved','denied');

CREATE TABLE public.role_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  requested_role public.app_role NOT NULL,
  justification text,
  status public.role_request_status NOT NULL DEFAULT 'pending',
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX role_requests_one_pending
  ON public.role_requests(user_id, requested_role)
  WHERE status = 'pending';

ALTER TABLE public.role_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users insert own role request"
  ON public.role_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users see own role requests"
  ON public.role_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "admins manage role requests"
  ON public.role_requests FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- bootstrap first admin (only when zero admins exist)
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_count int;
BEGIN
  SELECT count(*) INTO admin_count FROM public.user_roles WHERE role = 'admin';
  IF admin_count > 0 THEN
    RETURN false;
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.audit_events (actor_id, action, entity, entity_id, meta)
  VALUES (_user_id, 'role.bootstrap_admin', 'user_roles', _user_id, jsonb_build_object('role','admin'));
  RETURN true;
END $$;

-- count admins (for UI gating)
CREATE OR REPLACE FUNCTION public.admin_count()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT count(*)::int FROM public.user_roles WHERE role = 'admin' $$;

-- grant_role: admin-only
CREATE OR REPLACE FUNCTION public.grant_role(_target uuid, _role public.app_role)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (_target, _role)
  ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.audit_events (actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), 'role.grant', 'user_roles', _target, jsonb_build_object('role',_role));
  RETURN true;
END $$;

-- revoke_role: admin-only, blocks removing last admin
CREATE OR REPLACE FUNCTION public.revoke_role(_target uuid, _role public.app_role)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE remaining int;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _role = 'admin' THEN
    SELECT count(*) INTO remaining FROM public.user_roles WHERE role='admin' AND user_id <> _target;
    IF remaining < 1 THEN
      RAISE EXCEPTION 'cannot remove last admin';
    END IF;
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _target AND role = _role;
  INSERT INTO public.audit_events (actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), 'role.revoke', 'user_roles', _target, jsonb_build_object('role',_role));
  RETURN true;
END $$;

-- decide_role_request: admin-only, also grants role on approve
CREATE OR REPLACE FUNCTION public.decide_role_request(_request_id uuid, _approve boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.role_requests;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT * INTO r FROM public.role_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' THEN
    RAISE EXCEPTION 'invalid request';
  END IF;
  UPDATE public.role_requests
    SET status = CASE WHEN _approve THEN 'approved'::role_request_status ELSE 'denied'::role_request_status END,
        decided_by = auth.uid(), decided_at = now()
    WHERE id = _request_id;
  IF _approve THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (r.user_id, r.requested_role)
      ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  INSERT INTO public.audit_events (actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(),
          CASE WHEN _approve THEN 'role_request.approved' ELSE 'role_request.denied' END,
          'role_requests', _request_id,
          jsonb_build_object('role', r.requested_role, 'user_id', r.user_id));
  RETURN true;
END $$;

-- log_audit: callable by any authenticated user, sets actor_id = auth.uid()
CREATE OR REPLACE FUNCTION public.log_audit(_action text, _entity text, _entity_id uuid, _meta jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  INSERT INTO public.audit_events (actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), _action, _entity, _entity_id, COALESCE(_meta,'{}'::jsonb))
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;
