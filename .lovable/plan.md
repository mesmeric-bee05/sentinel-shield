# Security observability, scan diff UI, export RBAC, contract tests

## What you get

1. **Production monitoring for security operations** — every security-sync webhook attempt, admin export run, and notifier retry emits a structured log line and a telemetry event, so rate limiting, payload-too-large errors, and failing Slack/email alerts are visible in production instead of only in the database.
2. **Scan diff page** — a new admin view comparing the last two security scans: which finding IDs were resolved, which are still remaining, which are newly introduced, with links to each scan's report.
3. **Locked-down exports** — CSV/JSON download endpoints for security findings and audit data verify admin role server-side before returning any rows; non-admins see the standard insufficient-permissions state.
4. **Contract tests** — automated tests that pin the shape of the security-sync metrics response and its pagination metadata, so a server change that breaks the dashboard fails the test run instead of the page.

## Implementation

### Structured logging + telemetry
- New `src/lib/telemetry.server.ts`: a single `emitSecurityEvent({ event, severity, attrs })` helper that (a) writes a one-line JSON log (`event`, `ts`, `severity`, plus flat attributes) and (b) forwards to Sentry via the Sentry ingest HTTP API when `SENTRY_DSN` is set, no-op otherwise. No new runtime dependency — plain `fetch` to the DSN store endpoint, so it stays Worker-safe.
- Wire it into:
  - `src/routes/api/public/security-sync.ts` — one event per attempt with the existing `AttemptStatus`, byte count, finding count, duration, IP; `rate_limited`, `payload_too_large`, `invalid_signature`, `replay`, `write_failed` at warn/error level.
  - `src/lib/security.functions.ts` export paths — event per export run with row count, filters, and duration.
  - `scripts/ci/notify-security.ts` — event per retry attempt and per final failure, still never failing the gate job.
- If `SENTRY_DSN` is not yet configured, I'll request it as a secret before wiring the transport; logs work without it.

### Scan diff page (`/app/admin/security-diff`)
- New server fn `getScanDiff` (admin-gated) that groups `security_findings` by `last_seen_at` scan boundaries, derives the latest two scan snapshots, and returns `{ resolved, remaining, newlyIntroduced, previousScanAt, latestScanAt }` keyed by `internal_id`.
- Page renders three labelled tables (resolved / remaining / new) with severity, scanner, resource, and a link to the per-scanner report anchor in `docs/security/findings-report.md` plus the existing tracker row.
- Reuses `PermissionDeniedCard` for non-admins and the shared export helpers for a CSV of the diff.

### Export RBAC
- Move findings/audit/metrics export data fetching behind explicit admin-verified server fns (`context.supabase.rpc('has_role', …)` before any `supabaseAdmin` use) — this pattern already exists for the list fns; I'll apply it to every export path and return the `Forbidden` shape rather than rows.
- Client export buttons disable and show the insufficient-permissions message when the server returns `Forbidden`.
- New `tests/security/export-rbac.test.ts` asserting anon and non-admin callers receive `Forbidden` and zero rows from each export fn.

### Contract tests
- New `tests/security/security-sync-metrics-contract.test.ts`: Zod schemas describing `getSecuritySyncMetrics` and the paginated attempts/audit responses (field names, types, nullability, pagination fields such as page/limit/total/hasMore). Tests parse real server responses against those schemas and fail on drift; the UI imports the same schemas so a rename breaks both sides.
- Registered as `test:metrics-contract` and added to `test:all` and the CI workflow.

### Blueprint gap pass
After the above, I'll re-read the shared blueprint and dev-prompt documents section by section, diff them against what exists, and report a concrete gap list (feature, where it belongs, effort) before building further — rather than silently expanding scope in this turn.

## Verification
- `bun run test:all` plus the two new suites green.
- Build and typecheck clean.
- Manual check of the diff page against current `security_findings` rows.
