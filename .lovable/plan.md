## Scope

Close out the remaining items from the master plan and reconcile the app with the ApexCare AI blueprint's security posture (HMAC-signed CSRF, DB-backed security tracker, automated authorization tests). Also fix known bugs in the CHW queue view surfaced during the last iteration.

Out of scope: WebAuthn/biometrics, blockchain audit ledger, ambient scribe wiring, and voice/WhatsApp booking — those are separate blueprint tracks.

## 1. Per-request CSRF token rotation (HMAC)

**Server**
- New `src/lib/csrf.server.ts`: `issueToken(userId)` returns `base64(iat).base64(hmacSHA256(SESSION_SECRET, userId + "|" + iat))`; `verifyToken(userId, token)` enforces 2h TTL and constant-time compare. Uses `CSRF_SECRET` env (fallback to `SUPABASE_SERVICE_ROLE_KEY` hashed).
- New `src/lib/csrf.functions.ts` exposing `getCsrfToken` (protected, returns `{ token, expiresAt }`).
- New `requireCsrf` middleware in `src/integrations/supabase/csrf-middleware.ts` (added alongside existing `requireSameOrigin`): reads `x-csrf-token` from `getRequest()`, verifies against `context.userId`; throws `Response("csrf_invalid", { status: 403 })`. Applied to every mutating server fn in `chw`, `email-domain`, `seo`, `roles`, `notifications*`, `holds`, `email-preview`, `profile`, `appointments`, `audit` modules. Read-only fns keep same-origin only.

**Client**
- New `src/lib/csrf-client.ts`: in-memory cache (never localStorage), auto-refresh on 403/csrf_invalid or when TTL <10m remaining. Refetches on `SIGNED_IN`/`USER_UPDATED`.
- New client `functionMiddleware` `attachCsrfToken` in `src/integrations/supabase/csrf-attacher.ts`, appended after `attachSupabaseAuth` in `src/start.ts`. Attaches `x-csrf-token` header on mutating methods only; on 403 with body `csrf_invalid`, invalidates cache and retries once.

## 2. DB-backed security findings sync

**Migration** (`security_findings`, `chw_requeue_log`, `chw_queue_health` view):
- `security_findings(scanner_name text, internal_id text, title, severity, resource, status enum(open|fixed|ignored), rationale, first_seen_at, last_seen_at, unique(scanner_name, internal_id))` + GRANT authenticated SELECT, service_role ALL + RLS admin-only SELECT.
- `chw_requeue_log(assignment_id, previous_status, retry_count, actor_id, created_at)` — admin read.
- `chw_queue_health` view exposing computed `age`, `sla_breached`, `stuck` per row.
- Seed the two accepted-risk rows (`care_facilities_phone_public`, `SUPA_authenticated_security_definer_function_executable`) with rationale linking to `docs/security/accepted-risks.md`.

**Server**
- `src/server/security.functions.ts`: `listSecurityFindings({ severity?, status?, scanner? })` (admin, csrf, same-origin).
- Public HMAC-protected route `src/routes/api/public/security-sync.ts`: verifies `x-signature` against `SECURITY_SYNC_SECRET`, upserts findings idempotently on `(scanner_name, internal_id)`, sets `last_seen_at = now()`. Rejects on bad signature with 401.

**UI**
- Rewrite `src/routes/app.admin.security.tsx` to read from the table (replacing static list). Filters by severity/status/scanner; badge for "Accepted risk" links to `#anchor` in `docs/security/accepted-risks.md`. Uses `PermissionDeniedCard` + `reasonFromResult`.

## 3. RLS / authorization test harness

- New `tests/security/rls.test.ts` (vitest) — ephemeral admin/provider/patient/CHW users via service role.
- Assertions:
  - Every mutating server fn: unauthenticated → 401, wrong-role → forbidden, correct-role → ok, missing CSRF → `csrf_invalid`.
  - PHI isolation: `providerA` cannot SELECT `chw_assignments`/`chw_check_ins`/`profiles` rows for `providerB`'s patients.
  - `chw_assignments` NOT in `supabase_realtime` publication (via `pg_publication_tables`).
  - `care_facilities.phone_e164` public read allowed (documented accepted risk).
- `bun run test:security` script; auto-skips when `SUPABASE_SERVICE_ROLE_KEY` absent so unauth'd CI does not fail.

## 4. CHW queue bug fixes

- Replace `<>` fragments carrying `key` inside the table body with `React.Fragment key={r.id}` — current shorthand drops the key and produces a React warning + occasional row diffing bugs (rows appearing to "flip" during 15s poll).
- Add `useEffect` cleanup guard: cancel in-flight `listFn` on unmount to prevent state updates after navigation.
- Include the `useEffect` `tab` dependency properly (remove eslint-disable) and re-load on filter changes only when `tab` changes, not on every render.
- Wire `retry_count` bump and audit into `updateAssignmentStatus` failure path so `last_error` is populated when a CHW status update fails — currently rows can only reach "failed" bucket manually.
- Persist bulk-requeue history to `chw_requeue_log` from `requeueFailed`/`requeueAssignment`.

## 5. Wire "insufficient permissions" everywhere else

Apply `reasonFromResult` + `PermissionDeniedCard` to the remaining admin surfaces still using raw toasts: `app.admin.audit.tsx`, `app.admin.roles.tsx`, `app.admin.notifications.tsx`, `app.admin.notifications.resend.tsx`, `app.admin.geo.tsx`, `app.admin.email-health.tsx`, `app.admin.email-preview.tsx`, `app.admin.chw.tsx`. Adds `csrf_invalid` copy: "Session token expired — reload to continue."

## 6. Verification

1. `bun run build` — must pass (import-graph safe: `csrf.server.ts` is `.server.ts`, `csrf.functions.ts` is thin).
2. Playwright smoke against `/app/admin/chw-queue`, `/app/admin/security`, `/app/admin/email-domain`: expect no `csrf_invalid` on first mutation, expect `PermissionDeniedCard` when signed in as non-admin.
3. `bun run test:security` (if service role key available in sandbox).
4. `security--run_security_scan` after migrations; reconcile any new findings against `security_findings`.

## Technical notes

- CSRF token stays in-memory only. Read-only GETs are exempt (already covered by bearer auth). Public `/api/public/*` routes (webhooks) never require CSRF — they verify HMAC signatures instead.
- The migration for `security_findings` uses `TO authenticated` GRANTs with RLS restricted to `has_role(auth.uid(),'admin')`; service_role writes bypass RLS for the sync endpoint.
- Do not touch `src/integrations/supabase/client.ts` / `client.server.ts` / `auth-middleware.ts` / `auth-attacher.ts` / `types.ts`.
- New env: `CSRF_SECRET` (server), `SECURITY_SYNC_SECRET` (server). Requested via `secrets--add_secret` on first migration run.
