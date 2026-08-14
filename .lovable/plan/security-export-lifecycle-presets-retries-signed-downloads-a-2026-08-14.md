# Security export lifecycle: presets, retries, signed downloads, alerts, retention

Nine related items across the security export/audit area. Grouped below by outcome.

## 1. Saved filter presets for the export audit panel

- New table `security_export_filter_presets` (name, dataset, actor filter, scan window, date range, owner).
- Presets are private to the admin who created them; a "shared" flag lets an admin publish one to all admins.
- `ExportAuditPanel` gains a preset bar: dropdown to apply, "Save current filters" (name prompt), rename, delete.
- Applying a preset sets every filter field at once and resets pagination to page 1.

## 2. Retry failed export jobs

- New admin action on the export jobs page: "Retry" appears only on failed jobs.
- Retry re-runs the same dataset/format/filters, increments `attempt_count` on the job row, and appends the previous failure to `attempt_history` so the reason for each attempt stays visible.
- The jobs table shows attempt count, last failure reason (full text, expandable), and time of each attempt.
- Retries are capped (default 5 attempts) with a clear message when the cap is hit.

## 3. Time-limited signed download URLs

- Completed job payloads are no longer returned inline through the list/download call.
- Requesting a download mints a short-lived signed token (HMAC, default 5-minute expiry) bound to the job id and the requesting admin's user id, recorded on the job row so it can be revoked.
- The browser fetches the file from a token-verifying endpoint that re-checks expiry, single use, admin identity, and job ownership before streaming the payload with the right content type and filename.
- Every mint and every redemption emits a telemetry event and an export-audit row.

## 4. Completion notifications

- Toast notifications when a job finishes or fails, driven by realtime updates on the jobs table (falls back to the existing poll when the socket is down).
- Optional per-admin email alert (uses the existing email sending path) with a toggle on the export jobs page: "Email me when exports finish". Emails contain job summary and a link to the page, never the payload or a signed URL.

## 5. Configurable retention and cleanup

- New `security_retention_settings` row-per-dataset config: retention days for `security_export_audit` and `security_export_jobs`, plus a separate shorter window for stored job payloads.
- Admin UI section to view and edit the windows, with a "Run cleanup now" action and last-run/last-deleted-count display.
- A scheduled daily job performs the cleanup: payload bodies are cleared first (older than payload window), then whole rows past their retention window. Every run writes a summary row so deletions are auditable.

## 6-9. CSV formula-injection hardening (follow-up to `csv_export_formula_inj`)

- Extend the escaping helper so neutralization is applied to **headers and every metadata field**, not just row cells: column labels, JSON-stringified filter blobs, joined array fields, and any string written into a tabular file.
- Route all tabular output through one sanitizer, including the JSON-to-CSV conversion used by the async job runner, so CSV produced server-side and client-side behave identically.
- End-to-end regression test: seed rows containing `=cmd|...`, `+1+1`, `-2+3`, `@SUM(A1)`, tab- and CR-prefixed values, and a formula in a column label; run both the client export path and the async job path; assert every dangerous cell is prefixed, quoting is still valid, and re-parsing the CSV yields the original values as plain text.
- A shared assertion helper is used by the existing parity tests so future export formats inherit the same check.
- New admin action: "Rescan this finding" for a single `internal_id`. It re-runs the app-side verification for that finding (for `csv_export_formula_inj`, generating a canary export through the shared serializer and asserting escaping), updates the finding status and `last_seen_at`, writes a `security_finding_audit` row with the result, and refreshes the audit table in place.

## Technical notes

- Migration adds: `security_export_filter_presets`, `security_retention_settings`, `security_retention_runs`, and new columns on `security_export_jobs` (`attempt_count`, `attempt_history`, `download_token_hash`, `download_token_expires_at`, `download_consumed_at`). All get GRANTs plus RLS scoped to admins (presets additionally scoped to the owner).
- Signed-download endpoint lives under the public API prefix and verifies the HMAC token itself with a timing-safe comparison; the secret is a server-only env value. No payload is reachable without a valid, unexpired, unconsumed token minted for that admin.
- Job payload retrieval switches from `downloadSecurityExportJob` returning the body to `mintSecurityExportDownload` returning a URL; the jobs page downloads via that URL.
- Cleanup runs through a scheduled call into a public API route authenticated with the project key, which then performs deletions with the service role.
- Retention, presets, retry, and rescan actions all reuse the existing `assertAdmin` + "insufficient permissions" UI pattern.
