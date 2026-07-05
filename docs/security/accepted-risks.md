# Accepted Security Risks

This document records security findings that have been reviewed and intentionally accepted, with rationale, compensating controls, and review cadence. Each entry corresponds to a row in `public.security_findings` with `status = 'ignored'`.

> **Owner:** Workspace admin (ApexCare AI)
> **Review cadence:** Every quarter, or when the related code/policy changes.

---

## 1. `care_facilities.phone` is publicly readable

| Field | Value |
| --- | --- |
| Scanner | `supabase_lov` |
| Internal ID | `care_facilities_phone_public` |
| Severity | warn |
| Resource | `public.care_facilities` (column `phone`) |
| Status | **Accepted** |
| Next review | 2026-09-12 |

### Rationale
`care_facilities` is the public-facing clinic directory used on the patient
"Find care" page. The `phone` column stores the clinic's published front-desk
number — the same value listed on the clinic's website and Google Maps. Hiding
it would break the core patient flow for booking a non-telemedicine visit.

### Compensating controls
- No PHI is stored in `care_facilities`; the row only contains the public
  identity of the facility (name, address, public phone, hours).
- The `is_active` policy gate excludes facilities that have been
  decommissioned, so deactivating a row immediately removes it from public
  responses.
- If a facility ever needs a private/administrative phone number, that value
  belongs in a separate non-public table (e.g. `care_facility_admin_contacts`
  with admin-only RLS), not added to this column.

### Drift triggers (re-open this risk if)
- A migration adds any column to `care_facilities` that is not safe for the
  public internet (internal extension, billing contact, partner credentials).
- The public read policy is widened beyond `is_active = true`.

---

## 2. SECURITY DEFINER functions remain executable by `authenticated`

| Field | Value |
| --- | --- |
| Scanner | `supabase` |
| Internal ID | `SUPA_authenticated_security_definer_function_executable` |
| Severity | warn |
| Resource | `public.has_role`, `public.acquire_slot_hold`, `public.release_slot_hold`, `public.log_audit`, `public.bootstrap_first_admin`, `public.grant_role`, `public.revoke_role`, `public.decide_role_request`, `public.admin_count`, `public.cleanup_expired_holds`, `public.handle_new_user` |
| Status | **Accepted** |
| Next review | 2026-09-12 |

### Rationale
Every flagged SECURITY DEFINER function performs its own authorization inside
the body and must remain callable from the authenticated client role:

- `has_role` is referenced by **every RLS policy** that scopes data by role.
  Revoking `EXECUTE` from `authenticated` would break RLS evaluation for the
  signed-in user and turn the app into a permanent permission error.
- `acquire_slot_hold` / `release_slot_hold` enforce `auth.uid()` checks and
  patient-ownership before any write; they are the primary booking primitive
  called from the patient UI.
- `grant_role`, `revoke_role`, `decide_role_request` all start with
  `IF NOT has_role(auth.uid(),'admin') THEN RAISE 'forbidden'` — the function
  body is the gate.
- `bootstrap_first_admin` self-protects by returning `false` when any admin
  already exists, so the first signed-in user can claim the role exactly once.
- `log_audit`, `admin_count`, `cleanup_expired_holds`, `handle_new_user` are
  utility helpers with read-only or self-scoped writes.

### Compensating controls
- All bodies start with an explicit `auth.uid()` / `has_role` gate.
- Audit trail: every privileged function inserts into `audit_events` before
  returning.
- Application-layer authorization in `createServerFn` handlers
  (`requireSupabaseAuth` + role checks) double-gates the same operations
  before the RPC is reached.

### Drift triggers (re-open this risk if)
- A new SECURITY DEFINER function is added to `public` without an
  authorization check in its body.
- An existing function's gate is removed, weakened, or made conditional on
  client-supplied input.
- The Supabase linter starts flagging a function not listed above.

## Security webhook test coverage

The `/api/public/security-sync` endpoint is covered by
`tests/security/security-sync.test.ts` (run with `bun run test:security-sync`,
or `bun run test:all` alongside the RLS suites). It exercises the handler
directly with fabricated `Request` objects and asserts both the HTTP
response and the resulting `security_sync_attempts` row for:

- Valid signature + fresh nonce → `200`, `status = accepted`, `signature_valid = true`.
- Duplicate nonce replay → `409`, `status = replay`, `signature_valid = true`, `nonce = null` (audit-only row).
- Stale `issued_at` (outside ±5 min window) → `400`, `status = invalid_payload`.
- Wrong HMAC secret → `401`, `status = invalid_signature`, `signature_valid = false`, `nonce = null`.
- Missing `x-signature` header → `401`.
- Malformed JSON body → `400`, `status = invalid_payload`, `signature_valid = true`.

Tests clean up all attempts written during their window and any findings
they inserted (matched by test-only `scanner_name`). They skip cleanly when
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or `SECURITY_SYNC_SECRET` are
missing, so they are safe to run in CI or locally.
