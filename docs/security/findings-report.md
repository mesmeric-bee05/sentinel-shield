# Security findings report

_Generated 2026-08-03T10:16:32.504Z from `public.security_findings`._

| Bucket | Count |
|---|---|
| Resolved (fixed) | 0 |
| Intentionally documented (ignored) | 2 |
| Remaining (open) | 0 |
| Total tracked | 2 |

## Remaining (open)

_None._

## Resolved

_None._

## Intentionally documented

| Internal ID | Severity | Scanner | Resource | Title | Last seen |
|---|---|---|---|---|---|
| `care_facilities_phone_public` | warn | supabase_lov | public.care_facilities | Care facility phone numbers publicly exposed | 2026-07-03T17:32:41.168932+00:00 |
| `SUPA_authenticated_security_definer_function_executable` | warn | supabase | public.has_role, acquire_slot_hold, ... | Signed-in users can execute SECURITY DEFINER functions | 2026-07-03T17:32:41.168932+00:00 |

## Remediation audit trail (last 100)

| Recorded | Internal ID | Resolution | Endpoints | Notes |
|---|---|---|---|---|
| 2026-08-03T10:16:19.68897+00:00 | `room_event_no_authz` | fixed | logRoomEvent (src/lib/appointments.functions.ts), /app/room/$appointmentId | Participation check added before writing room.join/room.leave audit events: caller must be the appointment patient or own the assigned provider record. Non-participants receive Forbidden and no audit row is written. Pinned in scripts/ci/security-gate.ts so reintroduction fails CI. |
| 2026-07-06T04:50:45.114429+00:00 | `seo_settings_unauthed` | fixed | getSeoSettings | Added requireSupabaseAuth middleware and admin has_role check; non-admins receive {settings:null, error:"Forbidden"}. |
| 2026-07-06T04:50:45.114429+00:00 | `provider_availability_public_read` | fixed |  | Replaced USING(true) policy with EXISTS(providers WHERE id=provider_id AND is_active=true). |
| 2026-07-06T04:50:45.114429+00:00 | `travel_time_cache_broad_authenticated_read` | fixed |  | Dropped broad "auth reads travel cache" policy; replaced with admin-only. Server-side writes continue via service role. |
