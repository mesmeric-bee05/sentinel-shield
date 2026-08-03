# Security test hardening + last open finding

## 1. Fix the one remaining active finding

`room_event_no_authz` — `logRoomEvent` (src/lib/appointments.functions.ts) writes a
`room.join` / `room.leave` audit event for any appointment UUID a signed-in user
supplies, with no ownership check, so the compliance trail can be forged.

Fix: before inserting, verify through the caller-scoped client that the appointment
exists and the caller is the patient or the assigned provider. Reject otherwise
(return a `Forbidden` result, no audit row). Then mark the finding fixed and record
it in `security_finding_audit` via `log_security_fix`.

## 2. Test additions

- **Audit export parity edge cases** (`tests/security/security-audit-parity.test.ts`):
  assert an empty filtered result exports header-only CSV and `[]` JSON with paging
  still returning page 1 empty; assert the final (partial) page slice matches the
  tail of the filtered set and full-page concatenation stays byte-identical.
- **Sync metrics panel integration test** (new
  `tests/security/security-sync-metrics-parity.test.ts`): seed attempts, call the
  same aggregation the panel uses, and assert the panel's client-side filters,
  paging, and top-IP rollup match the server metrics response exactly.
- **Endpoint abuse tests** (extend `tests/security/security-sync.test.ts`): oversize
  body (declared `content-length` and actual body) returns 413 and logs
  `payload_too_large`; a burst past the per-IP window returns 429 with `retry-after`
  and logs `rate_limited`; a legitimate signed sync from a fresh IP still returns
  200 and upserts.
- **Notifier unit test** (new `tests/security/notify-security.test.ts`): stub
  `fetch`, assert transient 5xx/network failures for Slack and Resend are retried
  with exponential backoff, that success after retry is reported, and that
  exhausted retries still exit 0 so the gate job's outcome is never changed by the
  notifier.

`notify-security.ts` currently does a single un-retried `fetch` per channel, so
retry + backoff (3 attempts, ~500ms/1s/2s, jittered) is added there as part of this
work, with the transport factored so the test can inject a fake fetch.

## 3. Permission regression run

Extend `tests/security/scope-regression.test.ts` to assert:
`security_sync_metrics_daily` is readable only through the admin server function
(anon/authenticated blocked), and `log_security_fix` raises `forbidden` for anon and
non-admin callers while succeeding for admin. Then run `test:rls-regression`,
`test:security`, `test:scope-regression`, and the parity suites.

## 4. Findings report export

Add `scripts/ci/export-findings-report.ts` writing a markdown + JSON snapshot of
`security_findings` grouped into resolved vs still-open internal_ids, saved to
`docs/security/findings-report.md` (checked in, regenerable) so the resolved/remaining
split after this change is visible.

## 5. CI gate update

Add `room_event_no_authz` to the `PINNED` list in `scripts/ci/security-gate.ts` so the
build fails if it reappears, and register the new test scripts (metrics parity,
notifier unit test) in `package.json` `test:all` and in `.github/workflows/ci.yml`
with failing logs surfaced in the job output.

## Technical notes

- Ownership check uses `context.supabase` (RLS-scoped) so the appointment lookup
  itself enforces visibility; the admin client is used only for the insert after the
  check passes.
- Rate-limit test uses a distinct synthetic `x-forwarded-for` per case so it cannot
  starve real syncs, and cleans up its `security_sync_attempts` rows.
- All new tests skip cleanly (exit 0) when service-role credentials are absent,
  matching the existing suites.
