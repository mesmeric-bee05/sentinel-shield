# ApexCare AI — Phase 2 Build Plan

Four cohesive workstreams that extend the Phase 1 foundation. Each ships its own route, server functions where required, RLS-safe data flow, and matches the Clinical Trust visual system.

---

## 1. Patient booking — confirmation + calendar integration

**Goal:** turn AI slot suggestions into a guided 3-step flow with a real confirmation screen and downloadable calendar invite.

Changes:
- Refactor `src/routes/app.discover.tsx` to drive a `BookingDialog` (new `src/components/booking/BookingDialog.tsx`) instead of inline `book()`.
- Steps: **Choose slot → Review (provider, time, channel, reason, AI summary) → Confirm**. Uses `summarizeIntake` server fn for the AI summary shown on review.
- On confirm: insert appointment, log to `audit_events` via a new `logAudit` server fn (admin client, action `appointment.created`), then show success state.
- Success state offers: **Add to calendar (.ics download)**, **Copy details**, **Go to Appointments**. ICS generated client-side (no dep) with proper VEVENT, UID, organizer, telemedicine join URL placeholder.
- Bookings made from AI suggestions store the chosen `Slot.reason` into `appointments.ai_summary`.
- Fix current bug: AI "Book" button always books with `filtered[0]` — replace with explicit provider picker tied to the slot.

## 2. Audit log viewer (admin)

**Goal:** secure, filterable, exportable view of `audit_events`.

New route `src/routes/app.admin.audit.tsx` (linked from Operations sidebar, admin-gated via `roles.includes("admin")` + `beforeLoad` redirect for non-admins).

Features:
- Server-side query with filters: date range (shadcn Calendar popovers), entity (select), action (select), actor email (text search joined to `profiles`).
- Paginated table (50/page) using shadcn `Table`. Columns: timestamp, actor (email + short id), entity, entity_id, action, meta (expandable JSON popover).
- **Export CSV** of current filter result (client-side Blob download, capped at 5,000 rows server-side).
- All queries via a `listAuditEvents` server fn using `requireSupabaseAuth` middleware so RLS (`admins view audit`) enforces access. No service role.
- Adds an admin self-audit entry on export (`audit.exported`).

## 3. Admin role-bootstrap + role management

**Goal:** safe path from zero admins → first super-admin → ongoing role grants, without ever exposing role mutation to clients.

Schema migration:
- New table `role_requests` (id, user_id, requested_role, justification, status enum `pending|approved|denied`, decided_by, decided_at, created_at). RLS: users insert/select their own; admins select/update all.
- New enum value or use existing `app_role`. Add unique partial index to prevent duplicate pending requests.
- New SQL function `bootstrap_first_admin(_user_id uuid)` SECURITY DEFINER: grants `admin` role **only if zero admins currently exist**. Idempotent and safe.
- New SQL function `grant_role(_target uuid, _role app_role)` SECURITY DEFINER, checks caller `has_role('admin')` before inserting into `user_roles`. Logs to `audit_events`.

Server functions (`src/server/roles.functions.ts`):
- `requestRole({ role, justification })` — patient-callable, inserts into `role_requests`.
- `bootstrapFirstAdmin()` — calls SQL fn; only succeeds when no admin exists. Exposed once on a new `/app/bootstrap` route shown only when the current user has no roles and the system has no admins (cheap check via server fn).
- `decideRoleRequest({ id, approve })` — admin-only, updates request and (on approve) calls `grant_role`.
- `revokeRole({ userId, role })` — admin-only.

UI:
- `src/routes/app.admin.roles.tsx` — pending requests queue, approve/deny, plus "Manage users" panel with search → assign/revoke `provider`/`admin`. All actions call server fns; no direct client `user_roles` writes.
- Patient-side: small "Apply to be a provider" entry on `/app/index` opening a request dialog.
- `src/routes/app.bootstrap.tsx` — one-time setup screen visible only when system has no admins.

Security guardrails:
- Client never inserts/updates `user_roles` directly. RLS already restricts this — we only add the server-fn UX.
- Every grant/revoke writes an `audit_events` row.

## 4. Telemedicine room shell + AI scribe placeholder

**Goal:** production-feeling consult room UI; real getUserMedia local preview; AI scribe stub wired to existing `scribeDraft`. Full WebRTC signaling stays Phase 3.

New route `src/routes/app.room.$appointmentId.tsx`:
- Loads appointment via server fn (`requireSupabaseAuth`); 404 if user is not patient or assigned provider.
- Layout: dark theme room, big remote-video tile (placeholder gradient + "Waiting for participant…"), local self-view PiP using `navigator.mediaDevices.getUserMedia({ video, audio })`, controls bar (mute, camera, screen share stub, end call).
- Pre-call device check modal with mic/camera permission states and device pickers.
- Right rail "AI Scribe" panel:
  - Live transcript area populated by Web Speech API (`SpeechRecognition`) when available; manual textarea fallback.
  - Buttons: **Generate SOAP draft** (calls `scribeDraft`), **Save to appointment** (writes draft into `appointments.ai_summary`), **Copy**.
  - Clear "Stub" badge — labeled as draft assistance, not medical record.
- "Join" buttons in `app.appointments.tsx` and provider dashboard now route to `/app/room/$appointmentId`.
- Audit entries on room enter/leave and on scribe save.

---

## Technical notes

- New files: `src/components/booking/BookingDialog.tsx`, `src/lib/ics.ts`, `src/server/audit.functions.ts`, `src/server/roles.functions.ts`, `src/server/appointments.functions.ts`, `src/server/telemedicine.functions.ts`, route files listed above.
- One migration: `role_requests` table + RLS + `bootstrap_first_admin` + `grant_role` + audit triggers.
- All server fns use `requireSupabaseAuth` middleware so RLS applies; only `bootstrap_first_admin` and `grant_role` rely on SECURITY DEFINER with explicit guards.
- No new npm deps. ICS and CSV are hand-rolled. Speech recognition is browser-native with graceful fallback.
- Sidebar gains "Operations → Audit log", "Operations → Roles" (admin only).

## Out of scope (Phase 3)

- Real WebRTC peer signaling (TURN/STUN, SDP exchange).
- Continuous ambient scribing with diarization.
- Blockchain-style hash-chain over `audit_events`.
- SSO/SAML and step-up MFA for admin actions.

Approve to proceed with implementation.