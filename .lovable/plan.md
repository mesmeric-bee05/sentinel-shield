
## Scope

Six work-streams. I'll keep edits surgical and only touch files needed per item.

---

### 1. GSC connect + verify: error states, auto-retry, republish history

**Files:** `src/server/seo.functions.ts`, `src/routes/app.admin.seo.gsc.tsx`, new migration for `gsc_republish_log`.

- New table `public.gsc_republish_log` (kind: `verify` | `sitemap_resubmit`, status: `success`|`failed`, http_status, error_message, duration_ms, actor_id). Standard GRANTs + admin-only RLS.
- Wrap `verifyAndSubmitSite` and `resubmitSitemap` to log every attempt (success + failure) with timing + parsed error.
- New `listGscHistory` serverFn (admin) returning last 50 rows.
- UI: error banners with parsed reason (e.g. `failedToFindMetaTag`, `403`, connector-missing) + an explicit "Retry" button. Auto-retry once with 2s backoff on transient 5xx/network failures.
- New "Republish history" card showing timestamp/kind/status/duration/error, with a manual "Resubmit sitemap" button.

### 2. Email-domain wizard: live DKIM/SPF/DMARC/NS diagnostics + delivery-switch event

**Files:** `src/server/email-domain.functions.ts`, `src/routes/app.admin.email-domain.tsx`.

- Extend `checkDnsRecords` result with per-record `expected`, `observed`, `diagnostic` (human reason: "TXT found but missing `v=spf1`", "NS still points to registrar default", etc.) and `lastCheckedAt`.
- Persist last check + last auto-switch timestamp in `email_settings` (new columns `last_dns_check_at`, `live_since_at`).
- UI: per-record expandable diagnostic row with copy-to-clipboard expected values. Banner card "Live delivery active since {timestamp}" once `delivery_mode` flips. Reads `audit_events` filtered to `email.delivery_mode_auto_live` to render history.

### 3. SEO audit: run history + per-section progress + export

**Files:** `src/server/seo.functions.ts`, `src/routes/app.admin.seo-audit.tsx`, migration for `seo_audit_runs`.

- New table `public.seo_audit_runs` (started_at, finished_at, duration_ms, summary jsonb, checks jsonb). Admin-only.
- `runSeoAudit` persists each run; new `listSeoAuditRuns` returns last 20.
- UI: history panel (timestamp, duration, pass/warn/fail counts). Per-section progress indicator already exists — add per-section spinner state during rerun. "Export JSON" + "Export CSV" download buttons for the latest run.

### 4. Fix `/app/chw` "Something went wrong"

**Files:** `src/routes/app.chw.tsx`, `src/server/chw.functions.ts`.

- Root cause: the embedded join `chw:chw_workers(display_name, user_id)` plus admin-client query fails for patient role with no `chw_workers` row — and the component crashes on `assignment.task_type.replace` when the list errors. The loader also surfaces `error` but UI ignores it.
- Fix: short-circuit early for non-CHW users (return empty + role flag), render a friendly empty state ("You are not part of the CHW program"), and guard render with `error` handling instead of throwing.

### 5. Enable Confirm Booking + patient↔CHW/provider contact

**Files:** `src/components/booking/BookingDialog.tsx`, `src/routes/app.appointments.tsx`, possibly new `src/components/contact/ContactActions.tsx`.

- Confirm-booking button is disabled while `step !== "review"` or hold not acquired or AI summary in flight. Add visible reason ("Reserving slot…", "Generating AI summary…") and a manual "Skip AI & confirm" fallback so the button is never silently stuck.
- Add `tel:` / `sms:` / in-app message actions on appointment cards and CHW assignment cards (uses existing phone fields in `chw_workers` / `provider_profiles` / `profiles`). For patients without provider phone exposed, render only the in-app message link.

### 6. Misc reliability & security pass

- Add explicit error boundaries on `/app/chw`, `/app/discover`, `/app/appointments` to avoid the generic "Something went wrong" page.
- Verify RLS + GRANTs on the two new tables (admin-only via `has_role`).
- Add audit_events rows for: GSC verify, GSC sitemap resubmit, SEO audit run, email delivery auto-switch (some already exist — fill the gaps).

---

## Out of scope / clarifications

- "Implement all features, technologies and securities" is open-ended; I'll cap this turn at the six items above. If you want me to also extend (e.g.) payments, video room, or full HIPAA review, tell me which next and I'll do them in follow-up turns.
- Republish here means **resubmit sitemap to Google** (no programmatic frontend republish API exists). Frontend re-publish of the app still needs a manual click in the Publish dialog.

Approve and I'll implement in this order: 4 → 5 → 1 → 3 → 2 → 6.
