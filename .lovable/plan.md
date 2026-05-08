# Phase 4 — Notifications Console, SMS/Email Live, Hardening, and Geo-Intelligence Foundation

This plan splits the request into two tracks: **Track A** ships the immediate, well-scoped items you asked for (audit console, security hardening, Twilio, email sender domain). **Track B** lays a realistic, security-first foundation for the ApexCare AI Geo-Intelligence Layer, CHW Mesh, AI Prior Auth, and Wearable Guardian — scoped to what is buildable in this app today, with clear stubs where external infrastructure (HSM, X12 clearinghouse, ambulance APIs, satellite messengers) is out of scope.

I will not try to ship all four "11/10" modules end-to-end in one pass — each is a multi-week build. Instead I will scaffold the data model, server functions, RLS, and UI shells so the system is real and extensible, not vapor.

---

## Track A — Operational hardening (ship first)

### A1. Notifications audit console
- New route `/app/admin/notifications` (admin-only via `has_role`).
- Server fn `listNotificationEvents` filters `audit_events` where `action IN ('email.sent','email.skipped','email.failed','sms.sent','sms.skipped','sms.failed')`.
- Filters: date range, channel (email/sms), status (sent/skipped/failed), actor email search, appointment id.
- Table: timestamp, channel, status, recipient (resolved from profile), appointment link, meta JSON inline.
- CSV export server fn (logs `audit.export` itself).
- Sidebar link under Admin.

### A2. SQL hardening (linter cleanup)
- Run `supabase--linter` and address every WARN/ERROR.
- Tighten `acquire_slot_hold`, `release_slot_hold`, `cleanup_expired_holds`, `bootstrap_first_admin`, `grant_role`, `revoke_role`, `decide_role_request`, `log_audit`, `has_role`, `admin_count`, `handle_new_user`:
  - `REVOKE EXECUTE ... FROM PUBLIC, anon` on every SECURITY DEFINER function; `GRANT EXECUTE TO authenticated` only where appropriate (`cleanup_expired_holds` → `GRANT TO service_role` only).
  - Ensure `SET search_path = public, pg_temp` everywhere (some are missing `pg_temp`).
  - Add explicit `SECURITY INVOKER` on the few helpers that don't need definer rights.
- Add a partial index on `slot_holds (provider_id, expires_at)` for the cleanup hot path.
- Schedule `cleanup_expired_holds` via `pg_cron` every minute.

### A3. Email sender domain + transactional sending
- Call `email_domain--check_email_domain_status`. If none → surface the email setup dialog button.
- After domain is configured: `email_domain--setup_email_infra`, then `email_domain--scaffold_transactional_email`.
- Create `src/lib/email-templates/booking-confirmation.tsx` (Clinical Trust palette, white body, Inter / Instrument Serif, room link button, "Add to calendar" link back to `/app/appointments`).
- Register in `src/lib/email-templates/registry.ts`.
- Create `src/lib/email/send.ts` helper with the Supabase JWT pattern.
- Refactor `bookAppointment` to call `sendTransactionalEmail` (replaces the current `fetch('/lovable/email/transactional/send')` call which uses the wrong path/auth shape).
- Audit `email.queued` instead of `email.sent` — actual send status moves to the queue/log.

### A4. Twilio SMS live
- `standard_connectors--connect` for Twilio.
- `secrets--add_secret` for `TWILIO_FROM_NUMBER` (E.164).
- After both are present, the existing `ContactPreferencesCard` SMS opt-in stays enabled; today it's already wired but disabled until a phone is set. Add a small "SMS provider connected ✓" indicator in the card (admin-visible) and an inline note about STOP-to-opt-out.
- Verify `bookAppointment`'s SMS branch end-to-end via a test booking; the audit row should flip from `sms.skipped {reason: twilio_not_configured}` to `sms.sent {sid}`.
- Add Twilio SMS Pumping Protection + Geo Permissions reminder in the admin Notifications page header.

---

## Track B — ApexCare AI Geo-Intelligence & next-gen modules (foundation pass)

I will build the **data model, RLS, server functions, and admin/clinician UI shells** for these four modules. Live external integrations (Mapbox tokens, OSRM, X12 clearinghouse, RapidSOS, wearable SDKs) are stubbed behind a typed adapter interface so we can flip them on per-environment without refactors.

### B1. Geo-Intelligence Layer (GIL) — Section 2.13
**Data**
- `patient_locations` (column-encrypted lat/lng using `pgsodium`-style envelope: store ciphertext + a key reference; key lives in Lovable secret, decryption only inside SECURITY DEFINER fn that requires `auth.uid() = patient_id` or `has_role('provider')` with an active appointment).
- `geo_fences` (id, owner_id, name, center_geohash, radius_m, kind: clinic/risk_zone/pharmacy).
- `geo_events` (patient_id, fence_id_hash, kind: enter/exit, occurred_at) — 30-day TTL via cron.
- `outbreak_signals` (geohash5, symptom_code, bucket_hour, count) — TimescaleDB-style continuous aggregate emulated in plain Postgres for now.

**Server functions**
- `suggestSlotsWithProximity` extends existing `suggestSlots`: accepts patient origin (or reads encrypted home), returns slots ranked with `score - λ * travelMinutes`. Travel time uses a `TravelTimeProvider` interface; default `HaversineProvider` (no external API). Mapbox/HERE adapters are stubs.
- `recordGeoEvent` accepts pre-hashed fence id only — server never sees raw coordinates. Rules engine is a simple table-driven evaluator (`geo_rules` table) that emits notifications via the existing notifications pipeline.
- `getOutbreakClusters` (admin) — DBSCAN-lite over `outbreak_signals` (k-NN density in plain SQL; no PHI, geohash-5 only).

**UI**
- `/app/admin/geo` — heatmap of `outbreak_signals` (geohash-5 grid rendered as colored cells; no Mapbox token required for v1, swappable later).
- `/app/admin/geo/fences` — CRUD for clinic fences.
- Patient discover page: optional "Use my location" toggle that runs proximity scoring locally (browser geolocation → server fn with coarsened geohash-6).
- Privacy banner + explicit opt-in dialog before any location is captured.

**Privacy guarantees baked into RLS**
- `patient_locations` SELECT: `patient_id = auth.uid()` only. Decryption fn requires explicit `purpose` arg and audit-logs every call.
- `geo_events` retention: cron `DELETE WHERE occurred_at < now() - interval '30 days'`.

### B2. CHW Mesh — Section 2.14 (foundation only)
- New role `chw` in `app_role` enum.
- Tables: `chw_tasks` (assignee, patient_id, kind, status, scheduled_for, location_geohash6), `chw_breadcrumbs` (assignee, geohash7, ts) — 7-day TTL.
- Server fn `assignChwTasks` — greedy nearest-neighbor allocator (full VRP/OR-Tools is out of scope for this pass; interface left in place).
- Route `/app/chw` — task list, mark complete, capture FHIR-style Questionnaire response (JSON for now). Offline-first PWA work is **explicitly out of scope** here; flagged as B2-next.

### B3. AI Prior Authorization Negotiator — Section 2.15 (skeleton)
- Tables: `prior_auth_cases` (appointment_id, payer_code, status: drafting/submitted/info_requested/approved/denied/peer_review, last_event_at), `prior_auth_events` (case_id, kind, payload jsonb, actor).
- Server fn `draftPriorAuthLetter` calls Lovable AI Gateway (`google/gemini-2.5-pro`) with a **de-identified** abstract + payer policy text only. PHI scrubber utility added (`src/lib/phi-scrub.ts`) with regex + name-list redaction; unit tests.
- X12 278/277 generation is **not** built — we generate a human-readable JSON envelope and surface a "Submit to clearinghouse" stub button that records the event. Flagged clearly as adapter point.
- Provider UI under `/app/provider/prior-auth`: list + drawer with the AI-drafted letter, approve/edit/sign (text signature for now; biometric/HSM left as stub).

### B4. AIClinical Guardian (Wearable + Emergency) — Section 2.16 (skeleton)
- Table: `wearable_events` (patient_id, kind: fall/hr_high/hr_low/spo2_low, vitals jsonb, occurred_at, ack_state).
- Server fn `ingestWearableEvent` — accepts opt-in events, runs the rule (e.g., fall + no ack 15s → create `emergency_session` row).
- Table: `emergency_sessions` (patient_id, opened_at, status, telemed_appointment_id nullable).
- Patient PWA: full-screen critical-alert modal on receipt of own `wearable_events` row via Supabase Realtime; "I'm OK" button writes ack within 15s.
- On no-ack → server creates a `scheduled` telemed appointment with the on-call provider (a new `on_call_rotation` table; admin UI to manage), flips `emergency_sessions.status` to `dispatched`, and emits an audit row + email/SMS to the on-call provider.
- RapidSOS / EMS dispatch is a stub adapter (`EmergencyDispatchProvider`), not live.
- Opt-in is explicit, with a dedicated consent screen and revocable toggle in profile.

---

## Cross-cutting hardening
- Run `supabase--linter` + `security--run_security_scan` at the end and fix every finding.
- Update `security--update_memory` to record what's intentionally public (provider listings, geohash-5 outbreak data) and what is hard-forbidden (raw patient coordinates leaving SECURITY DEFINER functions, PHI to LLM).
- Add `src/lib/phi-scrub.ts` with tests.
- Add a single `src/lib/adapters/` directory for `TravelTimeProvider`, `EmergencyDispatchProvider`, `PayerClearinghouseProvider`, `WearableProvider` so future real integrations slot in cleanly.
- Add `pg_cron` jobs: `cleanup_expired_holds` (every 1m), `purge_geo_events` (hourly), `purge_breadcrumbs` (hourly), `rollup_outbreak_signals` (every 15m).

---

## Sequencing & checkpoints
1. **A2 SQL hardening + cron** (lowest risk, unblocks linter).
2. **A3 Email domain + transactional template** (requires you to click the email-setup dialog once).
3. **A1 Notifications audit console** (depends on A3/A4 producing rows).
4. **A4 Twilio connect + secret + verify SMS send**.
5. **B1 GIL data model + RLS + admin heatmap + proximity scoring**.
6. **B4 Wearable Guardian skeleton + Realtime alert**.
7. **B3 Prior Auth skeleton + AI letter drafter + PHI scrubber**.
8. **B2 CHW Mesh skeleton**.
9. Final linter + security scan + memory update.

## What I need from you during execution
- Click the email-domain setup dialog when it appears (one-time DNS).
- Approve the Twilio connector dialog and paste a valid `TWILIO_FROM_NUMBER` in the secret prompt.
- Confirm you want **role `chw`** added to the existing `app_role` enum (it's permanent — enums can't drop values cleanly).
- Confirm you accept the **stub** approach for X12 / RapidSOS / Mapbox / wearable SDKs in this pass (real integrations are separate engagements).

## Out of scope for this pass (explicitly)
- Offline PWA + MBTiles + WASM OSRM (real device work, separate sprint).
- Hyperledger Fabric / IOTA Streams ledgers (audit_events table is the immutable store today).
- HSM-backed signing keys (would need a managed KMS; we'll use Supabase Vault as the interim).
- Real X12 EDI generation and clearinghouse submission.
- Live ambulance / RapidSOS dispatch.
- Native wearable SDKs (Apple Health / Garmin) — events arrive via a documented webhook only.
