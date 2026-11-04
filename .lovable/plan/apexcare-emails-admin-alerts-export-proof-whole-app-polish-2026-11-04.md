# ApexCare — Emails, Admin Alerts, Export Proof, Whole-App Polish

## Where things stand (verified today)

- **Sender domain: none configured.** Nothing can send yet — booking emails, export emails, and admin alerts all wait on this.
- **Booking confirmation email: already built.** Template exists and the booking flow already queues it; it just cannot deliver until the domain verifies.
- **Export finished/failed emails: template exists, trigger not connected yet.** The export job runner does not call the notifier.
- **Admin alerts (new bookings, security-sync spikes): not built yet.**
- **Export jobs page: fully built** (queue, progress, retry, signed single-use download). The real export test has no email dependency and can run now.
- **Your sender-domain answer** was an email address on a university domain (`…@spu.ac.ke`). A sender domain must be a domain **you own** — we cannot send from a university's domain.

## Phase 1 — Sender domain (your action, starts everything email)

1. You either (a) own a domain — enter it in the email setup dialog, or (b) buy one from Project Settings → Domains → Buy new domain, or use any registrar you already use.
2. I read back the exact nameserver records to add at your provider and walk you through them; Lovable verifies automatically (minutes to 72 hours).
3. Email sending switches on the moment verification completes — no further code changes needed for delivery.

## Phase 2 — Build all email + alert flows now (no domain needed to write/ship)

- **Booking confirmation** — review and polish the existing template, confirm the trigger fires on every booked slot with patient name, provider, time, channel, and room link.
- **Export finished/failed emails** — connect the existing notifier to the export job runner so admins get an email the moment a job completes or fails, with row count and a link to the export page.
- **New-booking admin alert** — new email template; fires when an appointment is booked, sent to `alvo4breezy@gmail.com`.
- **Security-sync spike alert** — watch the sync attempt log (rate-limited, oversized, and bad-signature events); when counts spike within a rolling window, email the admin immediately with the numbers.
- **Alert settings row** — one place storing the admin alert address and spike thresholds, editable later without code changes.
- **Real test send** — once the domain verifies, send a live test of each email type to `alvo4b1@gmail.com` and confirm delivery.

## Phase 3 — Real findings export, end to end (runs today, no email needed)

1. Sign in as admin and queue a real security-findings export from the export jobs page.
2. Watch it move queued → running → complete with live progress.
3. Open the signed single-use download link and inspect the CSV: every cell formula-neutralized (no live `=`, `+`, `-`, `@` leading cells), including JSON-to-CSV output.
4. Fix anything that does not behave exactly that way.

## Phase 4 — Whole-app visual/3D polish (per the ui-ux-pro-max skill)

Apply the skill's craft guidance across the entire app, with design tokens only (no hardcoded colors):

- **Patient surfaces**: landing, provider discovery, booking flow, consultation rooms — refined type/spacing, tasteful 3D depth and motion (page transitions, card hover, subtle parallax), honoring reduced-motion preferences.
- **Admin consoles**: dashboard, bookings, CHW queue, security pages — clearer hierarchy, status color language, animated progress and count-ups.
- **Motion budget**: purposeful micro-interactions only; no heavy libraries that hurt load time.

## Phase 5 — Full verification

- Typecheck and build clean; run the whole test suite plus new tests for the spike alert and export notifications.
- Browser walk-through of booking → confirmation email queued; export queue → signed CSV opens as plain text.
- Security scan re-run; fix anything new it reports.

## What still needs you

- Owning/entering the sender domain (Phase 1) — every email stays undelivered until then, though all of it is built and queued correctly.
- The final real test sends to `alvo4b1@gmail.com` happen right after DNS verifies.
