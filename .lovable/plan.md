
## Scope

Five tightly-related admin upgrades plus continued project hardening. All work stays inside the admin surface (`/app/admin/*`) and the server functions backing it. No schema redesigns — only additive columns/tables.

## 1. Exports (CSV + JSON) for history panels

Add a shared `useHistoryExport` helper in `src/lib/exports.ts` that turns an array of rows + a column map into either a CSV blob or a JSON blob and triggers a download. Wire two buttons ("Export CSV", "Export JSON") into:

- `app.admin.seo.gsc.tsx` → republish history panel (from `listGscHistory`)
- `app.admin.email-domain.tsx` → delivery-switch history panel (from `getDeliverySwitchHistory`)
- `app.admin.seo-audit.tsx` → audit run history panel (from `listSeoAuditRuns`)

Exports respect the active filter/search state so admins download what they see.

## 2. Retries with backoff + clear failure reasons

In `src/server/seo.functions.ts`, wrap the GSC verify, sitemap submit, and URL-inspection calls in a `withRetry(fn, { tries: 3, baseMs: 750 })` helper (exponential backoff, jitter, only retry on network / 5xx / 429). Each attempt is logged to `gsc_republish_log` with `attempt_number`, `status`, `error_code`, and `error_reason` parsed from the gateway response. Final failure surfaces a stable `reason` string (`network`, `unauthorized`, `not_verified`, `quota`, `unknown`) plus the raw message.

In the UI:
- GSC page shows last failure card with the parsed reason + raw message and a "Retry now" button (calls the same server fn).
- Email-domain wizard's DNS recheck and SEO audit rerun get the same retry semantics + manual retry control.

## 3. Filters, search, pagination for the three history panels

Extend `listGscHistory`, `getDeliverySwitchHistory`, `listSeoAuditRuns` to accept:

```
{ from?: string; to?: string; status?: string; q?: string; page: number; pageSize: number }
```

Server applies date range, status filter (pass/fail/warn or success/error), free-text search (subdomain / site URL / action), returns `{ rows, total }`. UI adds a filter bar (date range, status select, search input) and `Pagination` controls. Default page size 25.

## 4. CHW queue admin view (realtime)

New route `src/routes/app.admin.chw-queue.tsx` (admin-only). Reads from `chw_assignments` joined with `chw_check_ins`. Surfaces:

- Live counts by status (pending / accepted / in_progress / completed / cancelled / escalated / failed).
- Table with timestamp, task type, priority, assigned CHW, retry count, last error.
- "Re-run" button on stuck rows (status `pending` older than SLA, or `failed`) — calls a new server fn `requeueAssignment` that resets status to `pending`, increments `retry_count`, logs to `audit_events`.
- Realtime updates via `supabase.channel('admin-chw').on('postgres_changes', ...)` subscription so the table refreshes without polling.

Adds `retry_count` (int, default 0) and `last_error` (text) columns to `chw_assignments` via migration.

## 5. Authorization + CSRF hardening

Centralize admin-gate checks in a new server middleware `requireAdmin` (calls `has_role` once, throws 403). Apply to every mutating fn in `email-domain.functions.ts`, `seo.functions.ts`, `chw.functions.ts` admin paths, and the new queue fn. CSRF: add a same-origin check helper in `src/lib/csrf.server.ts` that inspects `Origin`/`Referer` headers inside `requireAdmin`; reject cross-origin POSTs with 403.

UI: shared `<PermissionDeniedCard reason="..." />` rendered when any of these admin queries return `{ error: "Forbidden" }`. Replaces today's silent empty states on the email-domain, GSC, audit, and queue pages.

## 6. Continued project work (in-scope side fixes)

- CHW queue patient view (`/app/chw`): finish the empty-state copy and ensure the "Message" / "Call" buttons on `app.appointments.tsx` open the telemedicine room / `tel:` link reliably.
- Booking flow: add `requireSupabaseAuth` + ownership check on `reserveSlot` / `confirmBooking` server fns, and surface "insufficient permissions" in `BookingDialog` instead of a generic error toast.

## Technical Notes

- New files: `src/lib/exports.ts`, `src/lib/csrf.server.ts`, `src/lib/retry.ts`, `src/routes/app.admin.chw-queue.tsx`, `src/components/admin/PermissionDeniedCard.tsx`, `src/components/admin/HistoryFilters.tsx`.
- Edited: the three admin route files, `src/server/seo.functions.ts`, `src/server/email-domain.functions.ts`, `src/server/chw.functions.ts`, `src/components/booking/BookingDialog.tsx`, `src/routes/app.appointments.tsx`, `src/integrations/supabase/auth-middleware.ts` (add `requireAdmin` export).
- Migration adds `retry_count`, `last_error`, `last_error_at` to `chw_assignments`; adds `attempt_number`, `error_code`, `error_reason` to `gsc_republish_log`.
- Retry helper is pure TS, no new dependency.
- CSV export uses `Blob` + `URL.createObjectURL`, no library.

## Out of Scope

- Reworking the underlying GSC OAuth handshake (already in place via the Lovable connector).
- Building a generic background-job runner — CHW "re-run" is a direct DB status reset + audit log, not a new queue system.
- Mobile-app or CHW-worker push notification integration.

Confirm and I'll implement.
