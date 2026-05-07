## Phase 3 — Booking polish, locking, and notifications

Four coordinated workstreams that build on the existing BookingDialog, appointments table, and audit pipeline.

---

### 1. Slot holding / locking (foundation — do this first)

Prevent double-booking once a patient confirms an AI-suggested slot.

**Schema** (new migration):
- New table `slot_holds`:
  - `id uuid pk`, `provider_id uuid`, `patient_id uuid`, `starts_at timestamptz`, `ends_at timestamptz`, `expires_at timestamptz`, `created_at timestamptz`
  - Index `(provider_id, starts_at, ends_at)` for overlap checks.
  - RLS: patient sees own holds; admins see all; providers see holds on their own provider rows.
- SQL function `acquire_slot_hold(_provider_id, _starts_at, _ends_at, _ttl_seconds default 180)` (SECURITY DEFINER):
  - Locks via advisory lock per provider.
  - Rejects if any active hold (`expires_at > now()`) **or** scheduled appointment overlaps the range.
  - Inserts a hold for `auth.uid()` and returns `{ ok, hold_id, expires_at }`.
- SQL function `release_slot_hold(_hold_id)` — deletes if owned by `auth.uid()`.
- SQL function `cleanup_expired_holds()` — `DELETE WHERE expires_at < now()`; called opportunistically inside `acquire_slot_hold`.
- Update `bookAppointment` server fn (in `src/server/appointments.functions.ts`):
  - Accept optional `holdId`.
  - Inside a transaction-like flow: re-check overlap against `appointments` AND other active holds (excluding our own hold), insert appointment, delete the hold.
  - Audit `appointment.created` with `hold_id` in meta.

**Discovery flow**:
- When user picks an AI suggestion (or "Book next available"), call new server fn `holdSlot` BEFORE opening BookingDialog.
- BookingDialog receives `hold` prop with `expiresAt`; shows live countdown ("Slot reserved for 2:43"). On dialog close/cancel, call `releaseSlot`.
- On expiry: disable Confirm, show "Hold expired — re-select a time" with a Retry button that calls `holdSlot` again.

**Effect on availability**: `suggestSlots` and any future provider-availability query subtracts active holds + scheduled appointments before returning suggestions.

---

### 2. Enhanced BookingDialog confirmation step

Show full ranked context next to the AI pre-summary.

- Extend `BookingDialog` props: accept `rankedSuggestions: Slot[]` (top 3 from `suggestSlots`) and `selectedIndex`.
- Add a "Why this slot" panel above the AI pre-summary:
  - Selected slot card (highlighted): provider name + specialty, time, channel icon, reason, score badge.
  - Two collapsed alternates with a "Switch" link — clicking releases current hold, acquires hold for the new slot, swaps state.
- Channel display: respect `provider.telemedicine_enabled`; show telemedicine room URL preview (`/app/room/<id>` placeholder until booking completes) and an in-person address row when applicable.
- Add a hold-countdown chip in the dialog header.

`app.discover.tsx` updates: pass the full `slots` array and the chosen index into `BookingDialog`.

---

### 3. ICS calendar preview + timezone validation

Make the downloaded `.ics` always match what the user saw.

- Create `src/lib/timezone.ts`: `getBrowserTimeZone()` (`Intl.DateTimeFormat().resolvedOptions().timeZone`), `formatInTz(date, tz)`, `assertSameInstant(iso, displayedLabel, tz)`.
- Extend `IcsEvent` with optional `timeZone`. Update `buildIcs` to emit a VTIMEZONE block + `DTSTART;TZID=...` / `DTEND;TZID=...` when `timeZone` is provided (still UTC fallback otherwise). This guarantees calendar apps render the exact wall-clock the patient picked.
- Pass `timeZone: getBrowserTimeZone()` from BookingDialog into `downloadIcs`.
- New "Calendar preview" step in BookingDialog success view (before Download):
  - Renders the parsed `.ics` summary: title, organizer, start/end shown in **both** the patient's TZ and UTC, location/room URL, description.
  - Validation banner: re-derives the start/end from `slot.iso`, compares to what will be written to the ICS. If they don't match (e.g. DST edge), show an error and block download.
- Surface the timezone clearly: "Times shown in America/New_York (your device)".

---

### 4. Email + optional SMS confirmations

Triggered server-side immediately after `bookAppointment` succeeds.

**Email (Lovable Emails — built-in)**:
- Prerequisites the user must complete in-product: configure an email sender domain, then we set up email infrastructure. Plan covers the code path; we'll trigger the setup dialog on execution.
- Create transactional template `src/lib/email-templates/booking-confirmation.tsx`:
  - Brand-aligned (Clinical Trust palette, Inter/Instrument Serif), white body background.
  - Sections: greeting, provider/time/channel summary, AI clinical pre-summary, telemedicine room button (`/app/room/<appointmentId>`) when applicable, "Add to calendar" instructions (link back to appointment page where the .ics download lives — attachments aren't supported by the platform), what-to-expect copy, contact info.
  - Register in `src/lib/email-templates/registry.ts` with `previewData`.
- Create `src/lib/email/send.ts` helper (per platform pattern).
- In `bookAppointment` handler, after audit insert:
  - Look up patient email + name from `profiles`.
  - Call the send-transactional-email server route with `idempotencyKey: booking-confirm-<appointmentId>`, `templateData: { patientName, providerName, specialty, whenLocal, whenUtc, channel, roomUrl, reason, aiSummary, appointmentUrl }`.
  - Failures are logged but never block the booking response.

**SMS (optional)**:
- Add `sms_opt_in boolean default false` and `phone_e164 text` to `profiles` (migration). UI toggle on `/app/index` profile area (out of scope to fully build here, but the column + toggle wired in).
- Add a per-booking checkbox in BookingDialog: "Also text me a reminder" (disabled if user has no phone or hasn't opted in, with a link to add it).
- Provider: Twilio via the standard connector. We'll request the user to connect Twilio when they enable SMS — until then the toggle stays disabled with a "Connect SMS provider" hint.
- New server fn `sendBookingSms({ appointmentId })`:
  - Reads phone + opt-in from profile, builds short message: `ApexCare: visit with Dr. <Name> on <local time>. Join: <short room URL or appointments link>. Reply STOP to opt out.`
  - Calls Twilio via the connector gateway using `LOVABLE_API_KEY` + `TWILIO_*` connection secrets.
  - Audit `sms.sent` / `sms.failed`.
- Called from `bookAppointment` only if patient opted in AND included the per-booking checkbox.

---

### Files to add / change

**New**
- `supabase/migrations/<ts>_slot_holds.sql` — table, RLS, `acquire_slot_hold`, `release_slot_hold`, `cleanup_expired_holds`.
- `supabase/migrations/<ts>_profile_sms.sql` — `sms_opt_in`, `phone_e164` on `profiles`.
- `src/server/holds.functions.ts` — `holdSlot`, `releaseSlot`.
- `src/server/notifications.functions.ts` — `sendBookingEmail`, `sendBookingSms` (called by `bookAppointment`; also exposed for resend).
- `src/lib/timezone.ts`
- `src/lib/email/send.ts`
- `src/lib/email-templates/booking-confirmation.tsx`
- `src/lib/email-templates/registry.ts` (created by scaffold; we add our template entry)
- Email infra scaffolded via the platform's setup tools (no manual SQL).

**Edited**
- `src/server/appointments.functions.ts` — accept `holdId`, transactional overlap check, fire email+SMS.
- `src/lib/ics.ts` — VTIMEZONE support, TZID parameters.
- `src/components/booking/BookingDialog.tsx` — ranked suggestions panel, hold countdown, ICS preview step, SMS opt-in checkbox, switch-alternate flow.
- `src/routes/app.discover.tsx` — acquire hold on suggestion click, pass `rankedSuggestions` + `selectedIndex` + `hold` to dialog, release on cancel.
- `src/routes/app.index.tsx` — small profile section to set phone + SMS opt-in (so the per-booking checkbox is usable).

### Sequencing during implementation
1. Slot-holds migration + server fns + booking integration (correctness foundation).
2. ICS timezone work + dialog preview step.
3. Ranked-suggestions panel + alternate switching.
4. Email scaffolding + booking-confirmation template + send on book.
5. SMS opt-in column, profile UI, Twilio connector wiring + send on book.

### What I'll need from you during execution
- Approve the email sender-domain setup dialog when it appears (one-time).
- Approve connecting **Twilio** when we reach the SMS step (or tell me to skip SMS and ship email only for now).
