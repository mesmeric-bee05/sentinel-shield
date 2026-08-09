# Security observability, export audit, live diff, and app-flow fixes

## Confirmed problems in the running app

- **CHW queue tab is broken.** The page shows "No QueryClient set, use QueryClientProvider to set one". Verified: no `QueryClientProvider` exists anywhere in the app (`src/router.tsx` creates the router with `context: {}`, and `src/routes/__root.tsx` has no provider), yet `src/routes/app.chw.tsx`, `app.admin.chw.tsx`, and `app.admin.geo.tsx` all use `useQuery`/`useMutation`. Every React Query page in the app fails the same way — this is a category bug, not one page.
- **Booking "Confirm booking" stays disabled.** The button is gated on a slot hold (`disabled={... || !hold || expired}`) and the dialog is stuck at "Reserving slot…", meaning the `holdSlot` call never resolves successfully and the failure is swallowed instead of shown. The AI pre-summary is stuck at "Drafting…" for the same swallowed-error reason. Root cause of the hold failure is not yet confirmed — verifying it is the first step of that fix.

## What gets built

### 1. Fix the app-wide React Query wiring (unblocks CHW queue)
Create a single `QueryClient` and provide it through the router context and a provider in the root route, following the TanStack Start + Query integration pattern. Then re-check CHW queue, admin CHW queue, and admin geo pages render live data.

### 2. Fix the booking confirm flow
Instrument and diagnose `holdSlot` (auth/CSRF/RPC failure), fix the underlying cause, and make the dialog fail loudly: show the actual reason, keep the "Retry hold" affordance, and add an AI-summary timeout so "Drafting…" cannot hang the flow. Confirm booking end-to-end in the preview afterwards.

### 3. Sentry alert rules for security spikes
- Extend telemetry so every emitted event carries a stable `correlation_id` and Sentry `fingerprint`, plus tags for `event`, `status`, and `channel`.
- Add a provisioning script (`scripts/ci/sentry-alerts.ts`) that creates/updates three metric-alert rules via the Sentry API: spikes in `security_sync.rate_limited`, `security_sync.payload_too_large`, and `notifier.retry_failed` (threshold + window documented in code and docs).
- Requires a Sentry auth token and org/project slugs; these will be requested as secrets before wiring, and the script is a no-op without them.

### 4. Export audit log
- New table `security_export_audit` (actor, timestamp, export kind, format, filters JSON, scan window start/end, row count, duration) with GRANTs, RLS, and admin-only SELECT.
- Every export server fn in `src/lib/security.functions.ts` writes one row after the admin check, alongside the existing telemetry event.
- New admin panel on the security-audit page listing export runs with the shared filters/pagination, plus its own CSV/JSON export driven by the RBAC-enforced server path.

### 5. Real-time scan diff refresh
Enable Realtime on `security_findings` and subscribe from `/app/admin/security-diff` inside a `useEffect` with proper channel teardown; on insert/update the page refetches the diff and shows a "new scan detected" indicator. Falls back to the existing manual Refresh button.

### 6. End-to-end admin tests
New suite covering: admin loads the diff page and sees the three buckets; CSV and JSON downloads return the same rows as the on-screen data; pagination walks every page; non-admin and anonymous callers get `Forbidden` with zero rows from the diff and each export fn. Registered as a `test:` script and added to `test:all` and CI.

### 7. Telemetry taxonomy docs
New `docs/telemetry.md`: every event name, its severity, required and optional attributes, the correlation-ID scheme, which Sentry alert rule consumes it, and how to add a new event without breaking the contract tests. Linked from `docs/CI.md`.

## Blueprint reconciliation
After the above, re-read the uploaded blueprint and dev-prompt end to end, diff them against the implemented surface, and report a concrete gap list (feature, where it belongs, effort) before expanding scope further.

## Verification
- `bun run test:all` plus the new E2E suite green; typecheck and build clean.
- Preview walkthrough: CHW queue loads, booking confirms, diff page updates after a simulated scan write, exports download with correct rows.
