# Admin export centre: retry, signed downloads, presets and retention

Finish the admin side of security exports so an admin can queue a job, watch it
progress, retry it when it fails, open a time-limited download link, reuse saved
filter presets, and control how long export data is kept.

## What you'll be able to do

1. **Export jobs page** (existing page, extended)
   - Live status with progress rows, size, duration and attempt count.
   - Failure reason shown inline, with attempt history (each past error + time).
   - **Retry** button on failed jobs (up to 5 attempts), disabled once the cap is hit.
   - **Download** now mints a one-time link that expires in 5 minutes and opens the
     file directly; the old inline download stays as a fallback if link minting fails.
   - Saved filter presets bar at the top: save the current dataset/date/search
     selection, pick one to refill the form, delete your own.

2. **Retention page** (new, `/app/admin/retention`)
   - Shows the current keep-windows per dataset (export audit rows, export job
     rows, and stored file payloads) and lets you edit them.
   - **Run cleanup now** button with a result summary (rows deleted, payloads
     cleared, duration).
   - Recent cleanup run history table.
   - A compact summary card on the admin dashboard linking here.

3. **End-to-end verification**
   - Queue a real security-findings export against live data, confirm it reaches
     "complete", mint a signed link, fetch it, and check the CSV: a JSON export of
     the same rows converted through the shared `sanitizeCell` helper must produce
     identical, formula-safe text (leading `=`, `+`, `-`, `@`, tab, CR prefixed with `'`).

## Bug found while reviewing

The retention code does not match the database. `security_retention_settings`
stores **one row per dataset** (`dataset`, `retention_days`,
`payload_retention_days`) with rows already present for `security_export_audit`
(180/7) and `security_export_jobs` (90/7), and `security_retention_runs` records
`dataset`, `deleted_rows`, `cleared_payloads`, `duration_ms`, `error`.

The current `security-retention.server.ts` / `security-retention.functions.ts`
instead read a single row with `export_audit_days`, `export_jobs_days`,
`job_payload_days`, `enabled`, and write `trigger_source` / `triggered_by` /
`audit_rows_deleted` on the run row. Every call would silently return defaults or
fail on insert. These two files will be rewritten to the per-dataset shape that
exists — no schema change, no data touched.

## Technical notes

- `src/lib/security-retention.server.ts`: rewrite `loadRetentionSettings` to return
  a per-dataset map, run cleanup per dataset, and insert one run row per dataset
  using the real column names.
- `src/lib/security-retention.functions.ts`: `getRetentionConfig` returns rows +
  recent runs; `updateRetentionConfig` upserts by `dataset` with bounds
  (1–3650 days); `runRetentionNow` stays admin-gated with telemetry.
- `src/routes/api/public/security-retention-cleanup.ts`: unchanged contract, adapts
  to the new result shape.
- `src/lib/security-export-datasets.ts`: add `attempt_count`, `attempt_history`,
  `download_token_expires_at` to `SecurityExportJob`; `listSecurityExportJobs` in
  `security.functions.ts` selects them (never `result_payload`).
- Export jobs page wires `retrySecurityExportJob` and `mintSecurityExportDownload`
  (both already implemented and admin-gated) through `useServerFn`, with
  `PermissionDeniedCard` on Forbidden, as the page already does.
- Presets reuse `ExportPresetBar` with a `PresetValues` mapping for the jobs page
  (dataset, date from/to, search); the component already handles owner/shared rows.
- New route `src/routes/app.admin.retention.tsx` with its own `head()` metadata and
  a nav entry in `src/routes/app.tsx` beside "Export jobs".
- Verification: a Vitest case asserting `jsonRowsToCsv` output over real findings
  columns equals `toCsv` output and contains no live formula cells, plus a live
  queue/mint/fetch pass against the running app.
