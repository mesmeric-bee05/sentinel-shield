# Hardening + verification plan

Eight deliverables, grouped so related edits ship together. Nothing here changes existing product UX beyond the admin surfaces already present.

## 1. CI: run test:security + test:rls-regression on every PR

- New workflow `.github/workflows/ci.yml` runs on `pull_request` and `push` to main:
  - `bun install --frozen-lockfile`
  - `bun run typecheck` (adds `tsgo --noEmit` script if missing)
  - `bun run test:security`
  - `bun run test:rls-regression`
  - `bun run test:unit` (new; vitest for the parity + auth tests below)
- Steps use `continue-on-error: false`, and each `bun run test:*` is wrapped so stdout+stderr are echoed to the job log (no swallowing). Failing suites fail the check.
- `docs/CI.md` documents the same commands so contributors without GitHub Actions can reproduce locally.

## 2. Security-scan gate in CI

- New workflow `.github/workflows/security-scan.yml` runs on PRs and nightly on main.
- Uses `SECURITY_SYNC_SECRET` (GitHub secret) to POST a signed "scan" request to `project--{id}.lovable.app/api/public/security-sync?trigger=1` and then queries the `security_findings` table via the publishable Data API.
- Job fails if any row has `internal_id` in the pinned list: `seo_settings_unauthed`, `provider_availability_public_read`, `travel_time_cache_broad_authenticated_read`.
- List lives in `scripts/ci/security-gate.ts` so we can extend it later.

## 3. Rate limiting + body-size cap on /api/public/security-sync

- Add a **16 KB body cap**: read `content-length`; if missing or > 16384, respond `413` and log `status='payload_too_large'`.
- Add a **DB-backed per-IP window**: before signature verification, count rows in `security_sync_attempts` for `source_ip` in the last 60s; if `> 30`, respond `429` and log `status='rate_limited'`. Legit syncs (well under 1/sec) are unaffected.
- `source_ip` is derived from `cf-connecting-ip` → `x-forwarded-for` first hop → `request.headers.get('x-real-ip')`.
- New tests in `tests/security/security-sync.test.ts` cover:
  - oversized body → 413 + attempt row
  - 31st request in 60s from same IP → 429 + attempt row
  - different IPs are counted separately

## 4. CHW requeue E2E (Playwright via shell)

- New `tests/e2e/chw-requeue.spec.ts` seeded via a small `tests/e2e/seed.ts` helper (uses `supabaseAdmin`) that:
  1. Creates 5 `chw_assignments`: 3 `failed`, 2 `succeeded`.
  2. Signs in as a seeded admin, opens `/app/admin/chw-queue`, clicks "Requeue failed".
  3. Asserts that exactly the 3 failed IDs appear in `chw_requeue_log` with outcome `requeued`, and the 2 succeeded IDs have no new log rows.
  4. Re-runs "Requeue failed" and asserts the same 3 rows are unchanged in count (idempotent for already-in-flight).
- Runner script `bun run test:e2e` (Playwright with headless Chromium, uses the pre-installed browser per project convention).

## 5. RequeueLogPanel filter + pagination parity (vitest + RTL)

- New `tests/ui/requeue-log-panel.test.tsx` mounts `RequeueLogPanel` with a mocked `listRequeueLog` server fn.
- For a fixed fake dataset of ~150 rows across scopes/outcomes/dates:
  - Drives the search, scope, date filters and pager.
  - Captures the request args passed to the mocked server fn for each page shown.
  - Calls the same export helpers the panel calls for CSV and JSON.
  - Asserts that the union of rows across paged calls == parsed CSV rows == parsed JSON rows, and that column ordering + escaping match byte-for-byte.
- Registered under `bun run test:unit`.

## 6. Auth + RLS scope tests

Extend `tests/security/rls-regression.test.ts` (or new sibling `tests/security/scope-regression.test.ts`) with:

- `getSeoSettings`:
  - anon call → `{ settings: null, error: 'Forbidden' }` (via `Response 401` from `requireSupabaseAuth`)
  - signed-in non-admin → `{ settings: null, error: 'Forbidden' }`
  - admin → `settings` returned
- `provider_availability`:
  - Seed one active + one inactive provider each with an availability row.
  - anon SELECT sees only the active provider's row; inactive one is filtered.
- `travel_time_cache`:
  - Seed one row via service role.
  - anon SELECT → 0 rows / error
  - authenticated non-admin → 0 rows
  - admin → row visible
  - service role write path continues to work

## 7. security_finding_audit table + writer

- Migration creates:

  ```sql
  CREATE TABLE public.security_finding_audit (
    id uuid PK,
    internal_id text NOT NULL,
    scanner_name text NOT NULL,
    resolution text NOT NULL, -- 'fixed' | 'ignored' | 'reintroduced'
    affected_endpoints text[] NOT NULL DEFAULT '{}',
    affected_queries  text[] NOT NULL DEFAULT '{}',
    notes text,
    resolved_by uuid REFERENCES auth.users,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  ```
  followed by the mandatory GRANT block (authenticated SELECT, service_role ALL — no anon), RLS enabled, admin-only SELECT policy, service-role-only INSERT (via a `SECURITY DEFINER` `log_security_fix(...)` RPC gated by `has_role(auth.uid(),'admin')`).
- Backfill migration inserts three rows for the already-fixed findings:
  - `seo_settings_unauthed` — endpoints: `getSeoSettings`; notes: added `requireSupabaseAuth` + admin check.
  - `provider_availability_public_read` — queries: `provider_availability SELECT`; notes: added active-provider filter.
  - `travel_time_cache_broad_authenticated_read` — queries: `travel_time_cache SELECT`; notes: restricted to admin.
- `security-sync` webhook, after a successful accepted apply, calls `log_security_fix` for each finding transitioning to fixed so the log stays current.
- New admin surface `/app/admin/security-audit` (small, read-only table) shows the log with CSV export, following the existing admin page pattern.

## 8. Re-run the security scan and confirm

- Call `security--run_security_scan` after all edits land.
- Confirm the three fixed `internal_id`s are absent and report any new findings back for triage (won't auto-fix — outside the requested scope).

## Technical notes

- Rate-limit numbers (30 req / 60 s / IP, 16 KB) are picked to sit an order of magnitude above expected sync cadence; both are configurable via env (`SECURITY_SYNC_RATE_MAX`, `SECURITY_SYNC_MAX_BYTES`).
- Playwright uses the sandbox's pre-installed Chromium; workflow uses `npx playwright install --with-deps chromium` for GitHub-hosted runners.
- CI workflows require GitHub secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SECURITY_SYNC_SECRET`, `PROJECT_ID`. Documented in `docs/CI.md`.
- No existing table or policy is loosened; the RLS scope tests will fail loudly if a future migration regresses the fixes.

## Out of scope

- Rewriting existing admin pages beyond the small new `/app/admin/security-audit` view.
- Global rate-limit primitive for other public routes (only `/api/public/security-sync` is in scope).
- Changing the webhook signature/nonce contract.
