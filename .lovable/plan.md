## Goals
Harden mutating server endpoints, give admins a consistent "insufficient permissions" experience, make the CHW queue diagnostics actionable, and surface the security posture (live findings + accepted-risk records) inside the app.

## 1. CSRF + authorization hardening
- Add `src/server/csrf.server.ts`: issues an HMAC-signed token (server secret + userId + timestamp) and verifies `x-csrf-token` header against the bearer-token subject; rejects with `403 csrf_invalid` on mismatch or >2h age.
- Add a `requireCsrf` server function middleware that runs after `requireSupabaseAuth`; apply to every mutating `createServerFn` in `src/server/email-domain.functions.ts`, `src/server/chw.functions.ts` (dispatch/update/requeue/upsert worker), `src/server/seo.functions.ts` (GSC verify/sitemap/republish/audit run), `src/server/roles.functions.ts`, `src/server/notifications.resend.functions.ts`, `src/server/holds.functions.ts`, `src/lib/email-preview.functions.ts`.
- Add `getCsrfToken` server fn + client helper `useCsrfToken()` that caches the token and attaches it through a global client middleware appended to `functionMiddleware` in `src/start.ts` (alongside `attachSupabaseAuth`).
- Add an explicit admin assertion helper (`assertAdmin(context)`) used by every admin-only fn so role checks are uniform and audit-logged on denial.

## 2. Consistent "insufficient permissions" UX
- Extend `src/components/admin/PermissionDeniedCard.tsx` with optional `actionHref`/`actionLabel` and a recovery checklist (request admin role, sign in with different account, contact workspace owner).
- Add `src/lib/permission.ts#isForbidden(result)` that detects `error === "Forbidden"` / `403` / `csrf_invalid` from any server fn response.
- Wire it into `app.admin.seo.gsc.tsx`, `app.admin.email-domain.tsx`, `app.admin.seo-audit.tsx`, `app.admin.chw-queue.tsx`, `app.admin.audit.tsx` so the same card renders for all four denial modes with cause-specific copy ("Admin role required", "Session expired – sign in again", "CSRF token invalid – reload page").

## 3. CHW queue diagnostics + correct re-run
- Migration: add `stuck_at` generated timestamp helper as a view `chw_queue_health` (status, age, retry_count, last_error, last_error_at, expected SLA per priority).
- `listAdminQueue` returns: per-status counts, stuck buckets (>30m pending / >2h in_progress / failed-with-error), and SLA breach flags.
- New `requeueFailed({ ids?: string[] | "all_failed" })` that only operates on rows whose `status in ('cancelled','escalated')` OR `last_error is not null`; existing `requeueAssignment` stays for single-row admin override. Both bump `retry_count`, clear `last_error`, log to `audit_events` and to a new `chw_requeue_log` table (assignment_id, previous_status, retry_count, actor_id).
- Admin UI in `app.admin.chw-queue.tsx`: tabs "All / Stuck / Failed", expandable row showing last_error + last_error_at + retry history (joined from log), bulk "Re-run failed only" button that is disabled when no rows qualify.

## 4. Security tracker page
- New route `src/routes/app.admin.security.tsx` (admin-gated).
- New server fn `listSecurityFindings` reading from a new `security_findings` table (scanner_name, internal_id, title, severity, resource, status: open/fixed/ignored, rationale, last_seen_at, first_seen_at). Service-role only writes; admin read.
- New `src/routes/api/public/security-sync.ts` server route, HMAC-protected via `SECURITY_SYNC_SECRET`, accepts the scanner JSON payload and upserts findings (idempotent on scanner_name+internal_id).
- UI: filter by severity/status/scanner, badge for "Documented accepted risk", link-out to remediation note. Initial seed migration inserts the two accepted-risk records (`care_facilities_phone_public`, `SUPA_authenticated_security_definer_function_executable`) with their rationale text already captured in security memory.

## 5. Accepted-risk remediation records
- Add `docs/security/accepted-risks.md` with one entry per ignored finding: ID, scanner, scope, rationale, compensating controls (RLS scoping, self-auth in definer functions), review cadence (next review date), and owner.
- Tracker page links each `status='ignored'` row to its `docs/security/accepted-risks.md` anchor.

## 6. RLS / authorization test harness
- Add `tests/security/rls.test.ts` (vitest) that:
  - Creates ephemeral patient/provider/admin/CHW users via service role.
  - For every protected server fn, asserts unauthenticated → 401, wrong-role → forbidden, correct-role → ok.
  - For PHI tables (`profiles`, `chw_assignments`, `chw_check_ins`, `chw_workers`), asserts providerA cannot read providerB's patient rows.
  - Asserts `chw_assignments` is absent from `supabase_realtime` publication.
- Add `bun test:security` script. Tests run against the dev Supabase project using `SUPABASE_SERVICE_ROLE_KEY` from env; skipped when key missing so CI on forks doesn't fail.

## 7. Re-run all scanners + report
- After implementation, call `security--run_security_scan` and `connector_security_scan` via the security toolset; surface any new findings in the new tracker page and in the chat reply (no findings asserted as fixed unless re-scan confirms).

## Technical notes
- CSRF token derivation: `hmacSHA256(SESSION_SECRET, userId + "|" + issuedAt)`; client fetches on auth state change and caches in memory only (never localStorage).
- All new server fns return `{ error: "Forbidden" | "csrf_invalid" | null, ... }` so `PermissionDeniedCard` switch can render the right copy without inspecting strings.
- New tables added in one migration, with explicit `GRANT` to `authenticated` (read) and `service_role` (all), RLS policies `has_role(auth.uid(),'admin')` for read.
- Realtime stays disabled for `chw_assignments`; the admin queue uses polling on a 10s interval plus manual refresh.

## Out of scope
- Per-user CSRF rotation on every request (we use session-bound token with 2h TTL).
- Replacing the GSC OAuth handshake.
- Adding push notifications for stuck-job alerts (logged only; email/SMS alerting tracked separately).
- Wiz scanner integration beyond reading whatever `connector_security_scan` already returns.
