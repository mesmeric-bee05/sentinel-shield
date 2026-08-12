# Export audit search, async exports, Sentry links, and diff backfill

## Verified current state

- `security_export_audit` exists with actor, export kind, format, filters, scan window, row count, duration — but **no correlation ID column**, and the admin panel (`ExportAuditPanel`) only lists rows with page/next, no search or filters.
- `listSecurityExportAudit` accepts search/from/to already, but search only matches `export_kind`; the UI never sends filters.
- Exports are synchronous: `runServerExport` loops pages client-side (500/page, 20k ceiling) and downloads in the browser. There is no job record or progress page.
- Telemetry (`src/lib/telemetry.ts`) generates a Sentry `event_id` per emit but does not return or persist it, so nothing in the admin UI can link back to Sentry.
- The scan-diff page subscribes to `security_findings` postgres changes with a 1.5s debounce, but has no reconnect/backfill: events during a dropped socket or page-away are lost until manual refresh.

## What gets built

### 1. Export audit search and filters
Add a filter bar to the export audit panel: free-text actor (UUID prefix / email), export type dropdown (populated from distinct `export_kind` values), scan-window range, and created-at time range, with server-side pagination unchanged. Extend `listSecurityExportAudit` so search matches actor and export kind, and add explicit `scanWindowFrom` / `scanWindowTo` filters distinct from the created-at range.

### 2. Async export jobs with a status page
- New table `security_export_jobs`: requester, dataset, format, filters, status (`queued` → `running` → `complete` / `failed`), progress (rows so far / total), result payload reference, error, timings. Admin-only RLS plus GRANTs.
- New server functions: `startSecurityExportJob` (admin-checked, creates the job and runs page collection), `getSecurityExportJob` (poll status/progress), `downloadSecurityExportJob` (returns the finished CSV/JSON payload; refuses unless status is `complete` and the caller is the requester or an admin).
- New admin page `/app/admin/security-exports`: submit an export, watch progress, and download only once the job completes. Existing pages' export buttons enqueue a job and link to this page instead of blocking on a long inline loop.
- Every job start/finish writes the existing `security_export_audit` row and emits telemetry.

### 3. Sentry correlation links
- `emitSecurityEvent` returns the generated Sentry `event_id`; add a `correlation_id` to the structured log line and thread it through security-sync attempts, export audit rows, and export jobs (new nullable columns).
- Admin security audit, sync attempts, and export audit tables render a "Sentry" link built from a configurable org/project (`VITE_SENTRY_ORG` / `VITE_SENTRY_PROJECT`) pointing at the correlated event; the link is hidden when the config is absent.
- Failure rows also expose an inline "payload details" expander showing the recorded attributes (bytes, status, IP, error) so triage does not require Sentry access.

### 4. Scan-diff backfill on reconnect
Track the newest `last_seen_at` the page has rendered. On realtime subscribe/`SUBSCRIBED` re-entry, on socket `CHANNEL_ERROR`/`CLOSED` recovery, and on tab `visibilitychange` back to visible, run a catch-up fetch that reloads the diff if the server reports scan data newer than the tracked watermark — so missed scan-complete events during downtime are picked up. Add a low-frequency safety poll (60s) as a backstop, plus a visible "reconnected — refreshed" indicator.

### 5. Tests and docs
- Extend `tests/security/export-rbac.test.ts`: job start/poll/download are admin-only; download is refused while the job is incomplete.
- New test for the audit filter contract (actor/type/window/time filters narrow correctly, pagination metadata matches).
- Backfill unit test: watermark logic triggers a reload only when the server timestamp is newer.
- Update `docs/telemetry.md` with the correlation-ID propagation path and the new export-job events.

## Technical notes

- One migration creates `security_export_jobs` and adds `correlation_id` to `security_export_audit` and `security_sync_attempts`, each with GRANTs, RLS, and admin-only policies.
- Job execution runs inside the server function that creates it (Workers have no background queue); progress rows are updated as each page completes, so the status page reflects real progress and a long export survives the UI navigating away.
- Result payloads are stored in the job row as text when under a safe size cap, otherwise the job is marked failed with a "narrow your filters" reason.

## Verification

- `bun run test:all` and typecheck clean.
- Preview walkthrough as admin: filter export audit, run an async export end-to-end, confirm download is gated on completion, confirm the diff page refreshes after a simulated reconnect.
