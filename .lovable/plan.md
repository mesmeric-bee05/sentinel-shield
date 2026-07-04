## Scope

Four discrete additions on top of the existing security & CHW admin work.

### 1. CHW requeue log — CSV/JSON export

- Add server fn `listRequeueLog` in `src/lib/chw.functions.ts`: admin-only, reads `chw_requeue_log` joined with `chw_assignments` (task_type, status) and `profiles` (actor email), ordered by `created_at desc`, limit 500, with optional `scope`/date filters.
- Add a new "Re-queue log" section to `src/routes/app.admin.chw-queue.tsx` (collapsible panel below the assignments table): reuses `HistoryFilters`, `paginate`, `Pager`, and `downloadCsv` / `downloadJson` with `timestampedName("chw-requeue-log")`.
- Columns exported: created_at, assignment_id, previous_status, retry_count, scope, actor_id, actor_email, task_type.
- Uses `reasonFromResult` + `PermissionDeniedCard` on failure — same pattern as the rest of the tab.

### 2. Security-sync webhook attempt tracking

- Migration `security_sync_attempts` table:
  - Columns: `id uuid pk`, `received_at timestamptz default now()`, `source_ip text`, `nonce text`, `signature_valid boolean`, `payload_bytes int`, `finding_count int`, `status text check in ('accepted','invalid_signature','invalid_payload','replay','disabled','write_failed')`, `error text`, `duration_ms int`.
  - `GRANT SELECT, INSERT ON ... TO service_role` only (no anon/authenticated grants). RLS enabled with admin-only SELECT via `has_role`.
  - Index on `(received_at desc)` and unique index on `nonce` (nullable, partial `WHERE nonce IS NOT NULL`) — powers replay protection in §3.
- Extend `src/routes/api/public/security-sync.ts` to insert one row per attempt covering every failure branch (missing secret, bad signature, bad payload, replay, upsert failure, success).
- New admin page `src/routes/app.admin.security-sync.tsx`:
  - Lists attempts via new `listSecuritySyncAttempts` server fn in `src/lib/security.functions.ts` (admin-only).
  - Status badges (success / invalid_signature / replay / write_failed), filters (`HistoryFilters`), CSV/JSON export, 15s auto-refresh.
  - Header stat cards for last-24h totals per status.
- Add nav entry in `src/routes/app.admin.tsx` (Security section) linking to `/app/admin/security-sync`.

### 3. Replay protection on `/api/public/security-sync`

- Extend `BodySchema` with required `nonce: string` (uuid or 16–128 chars) and `issued_at: string` (ISO-8601).
- Enforcement in the route handler, BEFORE the DB upsert:
  1. `issued_at` must be within a ±5 minute window of server time → else `status = 'invalid_payload'` and 400.
  2. Attempt insert into `security_sync_attempts` with the nonce. Rely on the partial `UNIQUE (nonce)` index — duplicate nonce → PostgREST unique violation → return 409 with `status = 'replay'` recorded via a follow-up update or a dedicated no-op insert path.
  3. Only on success (fresh nonce + valid signature + valid schema) proceed to the `security_findings` upsert.
- Signature computation stays the same (HMAC-SHA256 over raw body), so nonce and issued_at are already covered by the signature.
- Update the documentation snippet in `docs/security/accepted-risks.md` (if the sync contract is documented there) to describe the new required fields.

### 4. RLS regression suite for `security_findings` + `chw_requeue_log`

- New file `tests/security/rls-regression.test.ts` (runnable via existing `bun run test:security`, add a second script `test:rls-regression` that runs it):
  - Skips when service-role key missing (same guard as `rls-check.ts`).
  - Provisions two ephemeral users via `admin.auth.admin.createUser`: `patient@test`, `admin@test`. Grants admin role to the second via direct `user_roles` insert with service role. Tears them down in a `finally`.
  - Builds three clients: `anon`, `patientClient` (signed in as patient), `adminClient` (signed in as admin), plus the existing service-role admin.
  - Assertions per table, for both tables:
    - anon SELECT → empty / permission denied
    - anon INSERT → denied
    - patient SELECT → empty (no rows visible)
    - patient INSERT → denied
    - admin SELECT → visible rows returned
    - admin INSERT (direct client) → denied unless a policy allows it (documents that writes go through server fns / service role)
    - service role SELECT + INSERT → succeeds
  - Adds a positive-write path: service role inserts a synthetic finding, admin sees it, anon does not, then service role deletes it.
- Prints a pass/fail tally identical to `rls-check.ts` and exits non-zero on any failure.

### Technical details

- New table SQL (single migration):
  ```sql
  CREATE TABLE public.security_sync_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    received_at timestamptz NOT NULL DEFAULT now(),
    source_ip text,
    nonce text,
    signature_valid boolean NOT NULL,
    payload_bytes int,
    finding_count int,
    status text NOT NULL CHECK (status IN
      ('accepted','invalid_signature','invalid_payload','replay','disabled','write_failed')),
    error text,
    duration_ms int
  );
  GRANT SELECT, INSERT ON public.security_sync_attempts TO service_role;
  ALTER TABLE public.security_sync_attempts ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "admins read sync attempts"
    ON public.security_sync_attempts FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(),'admin'));
  CREATE INDEX security_sync_attempts_received_idx
    ON public.security_sync_attempts (received_at DESC);
  CREATE UNIQUE INDEX security_sync_attempts_nonce_key
    ON public.security_sync_attempts (nonce) WHERE nonce IS NOT NULL;
  ```
  (Grant only to `service_role` because inserts come from the webhook handler and admin reads use `supabaseAdmin` in the server fn.)
- Replay-window constant `SYNC_REPLAY_WINDOW_MS = 5 * 60 * 1000` at top of the route file.
- Attempt insert uses `supabaseAdmin.from(...).insert(...).select('id').single()` — a unique-violation on nonce returns `code === '23505'`, which the handler treats as replay.
- The admin page follows the exact structure of `app.admin.security.tsx`: `PermissionDeniedCard`, `HistoryFilters`, stat cards, table, `Pager`, export buttons.
- No changes to CSRF middleware, auth middleware, or the existing `security_findings` table.

### Out of scope

- Storing raw payloads (privacy footprint; only metadata + nonce persisted).
- Long-term retention policy for `security_sync_attempts` (can be added later via pg_cron).
- Rotating the HMAC secret.

### Verification

- `bun run build` clean.
- `bun run test:security` (existing harness) + new `test:rls-regression` both green.
- Manually POST to `/api/public/security-sync` with a valid signature twice — second attempt returns 409 replay, both rows visible in the new admin page.
- Missing signature / stale `issued_at` produce the expected `invalid_signature` / `invalid_payload` rows.
- CHW queue tab: re-queue log panel loads, exports CSV & JSON with correct rows.
