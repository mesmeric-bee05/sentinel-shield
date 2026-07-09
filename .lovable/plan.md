## Scope

Four additions on top of the existing security tracker + CHW queue infrastructure. No changes to booking/CHW/SMS flows (those diagnostics from the pasted advice are already addressed in earlier turns — flagging here so we don't redo them).

## 1. Export parity tests for `security_finding_audit`

New file: `tests/security/audit-export-parity.test.ts`

- Seed ~30 rows in `security_finding_audit` via service role covering all three resolutions, varied dates, endpoints, queries, notes.
- For each fixture case (no filter, resolution filter, search filter, date range, empty result, last-page pagination boundary):
  - Call `listSecurityFindingAudit` via the server fn as an admin user.
  - Apply the same `applyHistoryFilter` + `paginate` locally.
  - Build CSV via `downloadCsv` column defs (extracted to a pure helper so the test can call it without DOM) and JSON via `downloadJson` helper.
  - Assert row count, header row, and byte-equivalence between paged view and export.
- Refactor: extract the export column config from `app.admin.security-audit.tsx` into `src/lib/security-audit-export.ts` so both the page and tests import it (no duplication).
- Wire `test:audit-export-parity` in `package.json` and add to `test:all`.

## 2. `notify-security.ts` tests

New file: `tests/security/notify-security.test.ts`

- Refactor `scripts/ci/notify-security.ts` to export a pure `runNotify({ payload, env, fetchImpl, logger })` function; keep the current top-level script as a thin wrapper reading env + file.
- Tests using a mock `fetchImpl`:
  - Payload with `ok: true` or empty `open` → no fetch calls, exit 0.
  - Neither Slack nor email configured → no fetch calls, log line emitted.
  - Slack only configured → exactly one POST to the webhook, correct Block Kit body.
  - Email configured but `RESEND_API_KEY` missing → warn, no fetch.
  - Slack transient 5xx → retried with exponential backoff (250ms, 500ms, 1s; jittered off in tests via injected sleep), succeeds on retry 3.
  - Slack persistent 5xx → after N retries logs error, still exits 0 (never breaks the gate job).
  - Resend 4xx → logged, no retry, exits 0.
- Add small `withRetry(fn, { attempts, sleep })` helper in the same file; inject `sleep` for test speed.
- Wire `test:notify-security` in `package.json` + `test:all`.

## 3. Richer security-scan gate annotations & PR comment

Edit `scripts/ci/security-gate.ts`:
- Add `report_url` and `artifact_url` fields to the JSON payload (`SECURITY_GATE_OUTPUT`).
  - `report_url` = `${RUN_URL}#summary` (job summary anchor).
  - `artifact_url` derived from `GITHUB_SERVER_URL/REPO/actions/runs/<id>/artifacts` (best-effort; kept null when unavailable).
- In each `::error` annotation, append `— details: <run_url>` so clicking the annotation deep-links to the run.
- Extend the markdown job summary: each row's `Internal ID` cell becomes a link to `#user-content-<internal_id>`, and add per-finding anchor sections below the table with the scanner name, status, and last-seen timestamp so anchors resolve.

Edit `.github/workflows/security-scan.yml`:
- Add a step (only on `pull_request`) that reads the JSON payload and posts / updates a sticky PR comment via `actions/github-script` containing the same table + the run + artifact links. Idempotent via a marker comment (`<!-- security-gate:comment -->`).
- Upload `/tmp/security-gate.json` as a workflow artifact so `artifact_url` resolves.

Edit `scripts/ci/notify-security.ts` (Slack/email): include `report_url` and `artifact_url` in the Block Kit context and email footer.

## 4. Aggregated metrics for `security_sync_attempts`

Migration `security_sync_metrics_view`:

```sql
CREATE OR REPLACE VIEW public.security_sync_metrics_daily AS
SELECT
  date_trunc('day', received_at) AS day,
  status,
  count(*)::int AS count,
  sum(payload_bytes)::bigint AS bytes,
  avg(duration_ms)::int AS avg_duration_ms,
  max(received_at) AS last_seen
FROM public.security_sync_attempts
GROUP BY 1, 2;

REVOKE ALL ON public.security_sync_metrics_daily FROM PUBLIC;
GRANT SELECT ON public.security_sync_metrics_daily TO service_role;
```

Reads stay admin-only via server fn.

New server fn in `src/lib/security.functions.ts`: `getSecuritySyncMetrics` — admin-gated, returns:
- 24h counters (per status)
- 7d rolling counters (per status)
- daily buckets for the last 14 days (chart data)
- top 5 source IPs by attempt count in last 24h

Edit `src/routes/app.admin.security-sync.tsx`:
- New "Metrics" section at the top: 4 stat tiles (accepted, rate_limited, replay, invalid_signature) with 24h vs 7d delta.
- A 14-day sparkline (SVG, no new deps) per non-accepted status stacked below.
- Top offender IPs table (already in scope of admin visibility per accepted-risks doc).
- Existing table + filters stay unchanged.

## Files touched

**New**
- `tests/security/audit-export-parity.test.ts`
- `tests/security/notify-security.test.ts`
- `src/lib/security-audit-export.ts`

**Edited**
- `scripts/ci/security-gate.ts` (report/artifact URLs, anchored summary)
- `scripts/ci/notify-security.ts` (extract `runNotify`, retries, link fields)
- `.github/workflows/security-scan.yml` (PR comment step, artifact upload)
- `src/lib/security.functions.ts` (add `getSecuritySyncMetrics`)
- `src/routes/app.admin.security-sync.tsx` (metrics panel)
- `src/routes/app.admin.security-audit.tsx` (import shared export config)
- `package.json` (new test scripts)

**Migration**
- Create `security_sync_metrics_daily` view + grants.

## Out of scope

- The CHW/SMS/booking-modal advice pasted in the message — those flows were already fixed in prior turns (validated phone input, timeout-guarded AI pre-summary, unblocked booking button, single `QueryClientProvider` in `src/router.tsx`). Re-doing them would regress current code. If any of those still repro in your preview, tell me which one and I'll open a targeted follow-up plan.
- New auth/CSRF work — already in place.
