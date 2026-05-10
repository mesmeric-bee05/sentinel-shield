# ApexCare AI — Notifications hardening & next-phase rollout

## 0. Important note on the sender address

`apexcare329@gmail.com` **cannot** be used as a transactional sender. Lovable Emails (and every reputable provider) requires a domain you control so we can publish SPF / DKIM / DMARC records — Gmail's domain is locked down by Google and will be rejected by every receiving server. To unblock you today I will:

1. Use Lovable's built-in **sandbox sender** (`notify.lovable.app`) so booking confirmations start flowing immediately to any inbox, *including* `apexcare329@gmail.com` as the **reply-to** so patient replies land in your Gmail.
2. Surface a one-click **"Set up sender domain"** action so the moment you point a domain (e.g. `apexcare.ai` or `notify.apexcare.ai`) at us, we flip the From address with zero code changes.

If you don't own a domain yet, the cheapest path is buying one (~$12/yr) — I'll wire DNS for you when you do.

---

## 1. Email infrastructure & booking-confirmation template

- Provision Lovable Cloud email infra (pgmq queues, `email_send_log`, `suppressed_emails`, `email_unsubscribe_tokens`, `process-email-queue` cron, vault secret).
- Scaffold transactional pipeline + `/lovable/email/transactional/send` route — this is the queue/worker/retry layer (5 attempts, exponential backoff, DLQ, 60-min TTL, rate-limit aware).
- Create React Email template `src/lib/email-templates/booking-confirmation.tsx` matching ApexCare's serif/accent design system. Props: `patientName, providerName, specialty, whenLocal, whenUtc, channel, location, roomUrl, appointmentUrl, reason, aiSummary, icsUrl`.
- Register in `registry.ts` with realistic `previewData`.
- Replace the current ad-hoc `fetch` in `appointments.functions.ts → sendBookingNotifications` with the canonical `sendTransactionalEmail` helper + `idempotencyKey: booking-confirm-<appointmentId>`.
- Audit events: keep `email.queued / email.sent / email.failed` writes; add `email.retried` from the worker.

## 2. Admin "Resend & preview" page

New route `/app/admin/notifications/resend` (admin-only, `has_role('admin')` gate):

- **Lookup** by appointment ID or patient email → shows appointment summary + recipient + every `email_send_log` row for that booking (status badge, attempts, last error, message_id, timestamps) deduped by `message_id`.
- **Live preview** pane rendering the React Email template with the real appointment data via `/lovable/email/transactional/preview`.
- **Resend** button → server fn `resendBookingConfirmation({ appointmentId })`:
  - Verifies admin, re-enqueues with a fresh idempotency key (`booking-confirm-<id>-resend-<timestamp>`),
  - Writes `audit_events` action `email.resent` with admin actor, original message_id, reason text (optional textarea).
- Inline error surface if recipient is in `suppressed_emails` (with the suppression reason and an explainer — never auto-bypass).
- Add link from existing `/app/admin/notifications` rows → "Open in resend tool".

## 3. Guided SMS test flow

New route `/app/admin/test/sms` (admin-only) that walks through:

1. **Pre-flight checks** (✓/✗ cards): `TWILIO_API_KEY` present, `TWILIO_FROM_NUMBER` present, current user's `profiles.phone_e164` set, `sms_opt_in = true`. Inline fixers for the last two (calls existing `updateContactPreferences`).
2. **"Open booking flow"** button → `/app/discover` with a query param that pre-checks the SMS opt-in box in `BookingDialog` and tags the booking meta `{ test_run: true }`.
3. **Live audit poller** — after returning, the page polls `audit_events` (filtered by `actor_id = me, action LIKE 'sms.%'`, last 5 min) every 2s for up to 60s.
4. **Result panel** showing `sms.sent` (green) with Twilio SID + status code, or `sms.failed/sms.skipped` (red) with the exact reason from `meta`. Deep-links to `/app/admin/notifications` filtered to that appointment.

## 4. Security hardening pass (expert review)

- Add RLS regression tests query in plan: ensure `audit_events` remains INSERT-only for service role, never UPDATE/DELETE.
- Lock down new `resendBookingConfirmation` server fn behind `requireSupabaseAuth` + explicit `has_role` check (defence in depth — don't trust route-level only).
- Verify `email_unsubscribe_tokens` table never leaks tokens via RLS to authenticated users.
- Run `supabase--linter` after migration and fix every warning before closing the task.
- Update `mem://security` with: "Resend endpoints must re-check admin role server-side; suppression list is never bypassable."

## 5. Blueprint extraction → backlog (not built this turn)

I parsed the two uploaded docs. Below is what's already shipped vs. what remains. **I will NOT scaffold all of these in this turn** — half-built modules are worse than none. I'll list them as tracked tasks and we pick the next one after this turn lands.

**Already shipped:** auth + RLS, role requests/approvals, providers + availability, slot holds with advisory locks, booking + ICS, telemedicine room shell, AI scribe stub, audit log + admin viewer, Geo-Intelligence, CHW Mesh, notifications audit, Twilio SMS.

**Remaining (prioritised):**
1. **Booking emails (this turn).**
2. Predictive no-show ML stub (rule-based v1, swap to model later).
3. Omnichannel agent — WhatsApp/voice intake (needs Twilio WA sandbox + a connector decision).
4. Ambient AI clinical scribe upgrade (real Whisper + Gemini summarisation via Lovable AI).
5. Patient sentiment NLP on post-visit feedback (Gemini Flash).
6. Wearable Guardian (needs HSM/KMS + device SDK certs — blocked on partnerships).
7. Blockchain audit anchor (hash-chain `audit_events` daily → cheap L2 anchor; defer until partnerships).
8. WebAuthn/FIDO2 step-up auth for admin actions.
9. PWA + offline sync.

---

## Technical details (for engineers)

**Files to create**
- `src/lib/email-templates/booking-confirmation.tsx`
- `src/lib/email-templates/registry.ts` (or update if scaffold creates it)
- `src/lib/email/send.ts` — `sendTransactionalEmail` helper
- `src/routes/app.admin.notifications.resend.tsx`
- `src/routes/app.admin.test.sms.tsx`
- `src/server/notifications.resend.functions.ts` — `resendBookingConfirmation`, `getBookingEmailHistory`, `previewBookingEmail`

**Files to edit**
- `src/server/appointments.functions.ts` — swap inline `fetch` for `sendTransactionalEmail`, add `templateData` for ICS link.
- `src/components/booking/BookingDialog.tsx` — read `?test=sms` param to pre-check opt-in and tag meta.
- `src/routes/app.tsx` — add "Resend" + "SMS test" sidebar links (admin-only).
- `src/routes/app.admin.notifications.tsx` — per-row "Resend" link.

**Migrations**
- None for emails (handled by setup tool).
- One small migration to add partial index `audit_events (actor_id, created_at)` filtered to `action LIKE 'sms.%'` to make the poller cheap.

**Tools called this turn (in order)**
1. `email_domain--check_email_domain_status`
2. `email_domain--setup_email_infra`
3. `email_domain--scaffold_transactional_email`
4. `supabase--migration` (audit index)
5. Code edits + new routes
6. `supabase--linter` → fix
7. `stack_modern--invoke-server-function` to smoke-test resend
8. `security--update_memory`

**Acceptance criteria**
- Booking from `/app/discover` produces `email.queued` then `email.sent` within 10s, visible in `/app/admin/notifications`.
- Admin can preview the exact rendered email for any past appointment and resend it; resend produces a new `email.sent` row + `email.resent` audit entry.
- Guided SMS test page reaches green `sms.sent` with Twilio SID surfaced.
- `supabase--linter` returns zero warnings introduced by this turn.

---

**Confirm two things before I implement:**
1. OK to start with Lovable's sandbox sender (with `apexcare329@gmail.com` as reply-to) until you provide a domain?
2. After this turn lands, which item from the "Remaining" list do you want next — no-show ML, omnichannel agent, or ambient scribe upgrade?