# Plan: harden tests and scale the requeue log

## 1. Verify build & existing test suites
- Run the TS build (`tsgo`) and address any type errors surfaced under `src/lib/security.functions.ts`, `src/routes/app.admin.security-sync.tsx`, `src/routes/app.admin.chw-queue.tsx`, and the new tests.
- Run `bun run test:security` (RLS smoke check) and `bun run test:rls-regression`. Fix genuine failures; if a test can't run in the sandbox (missing service-role key), keep the existing skip-guard and note it in the test output.

## 2. Security-sync webhook tests (new)
Create `tests/security/security-sync.test.ts` that exercises the real handler by importing the route module and invoking `Route.options.server.handlers.POST({ request })` directly with fabricated `Request` objects (no network). Uses `SECURITY_SYNC_SECRET` set inside the test.

Covered cases and assertions against `security_sync_attempts` via `supabaseAdmin`:
- **Happy path** — valid signature, fresh nonce → 200, one row `status = 'accepted'`, `signature_valid = true`, `finding_count` matches.
- **Replay** — repeat the same nonce → 409, second row `status = 'replay'`, `nonce = null` (existing behavior), and `security_findings` row count unchanged.
- **Stale `issued_at`** (>5 min old) — 400, row `status = 'invalid_payload'`, `error` contains `stale issued_at`.
- **Invalid signature** — signed with a different secret → 401, row `status = 'invalid_signature'`, `signature_valid = false`, `nonce = null`.
- **Malformed JSON / schema violation** — 400, row `status = 'invalid_payload'`, `signature_valid = true`.

Cleanup step deletes rows created by the test (by test-only `scanner_name = 'test-suite'` and by nonce prefix). Skip suite when service-role key is missing, matching the existing pattern.

Add `bun run test:security-sync` script and include it in the top-level `test:all` script (create if missing) that runs security + rls-regression + security-sync sequentially.

## 3. CHW requeue log: filters + server-side pagination
### Server function (`src/lib/chw.functions.ts`)
Extend `listRequeueLog` input to accept:
- `q?: string` (matches assignment id, actor email, reason)
- `from?: string`, `to?: string` (ISO date filters on `created_at`)
- `outcome?: 'success' | 'failed'`
- `page?: number` (1-based), `pageSize?: number` (default 50, max 200)
- `format?: 'page' | 'export'` — export path streams up to 5000 rows without join expansion for CSV/JSON.

Return `{ rows, total, page, pageSize }`. Use `.range()` + `count: 'exact'` on the base query, then hydrate joins per page to avoid PostgREST timeouts on wide joins across the full table. Keep admin gating via `has_role`.

### Admin UI (`src/routes/app.admin.chw-queue.tsx`)
- Wire the requeue log panel to `HistoryFilters` + `Pager` (already used by other admin pages) so filters and page changes call the server, not client-side slicing.
- Debounce search input (250 ms) before re-querying.
- Add loading + empty states; disable export while a query is in-flight.
- CSV/JSON export buttons call `listRequeueLog({ format: 'export', ...currentFilters })` and download the full filtered set via existing `downloadCsv` / `downloadJson` helpers.

### Types
Regenerate/patch `src/integrations/supabase/types.ts` only if a new column is needed (none expected). No migration required — pagination is query-only.

## 4. Docs
Append a short "Security webhook test coverage" section to `docs/security/accepted-risks.md` describing the new suite and how to run it locally.

## Out of scope
- No changes to the webhook contract or CSRF middleware.
- No new tables or RLS policies.
- No UI restyling beyond wiring pagination controls.

## Technical notes
- Test files use `bun:test` (matches existing suites) and import server modules directly instead of spinning HTTP — keeps runs hermetic.
- Pagination uses PostgREST `range` headers via supabase-js `.range(from, to)` with `{ count: 'exact' }`; count query is cheap thanks to the existing `created_at` index (add index only if EXPLAIN shows a seq scan — deferred).
