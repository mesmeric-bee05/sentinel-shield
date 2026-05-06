
# ApexCare AI — Phase 1 Build Plan

A category-defining product can't be built in a single pass. This plan delivers a **production-grade Phase 1 foundation** that establishes brand, security posture, data model, and the four pillars you selected — then leaves clean seams for Phase 2 (real WebRTC, ambient scribe, voice/WhatsApp agent, blockchain audit, predictive ML).

---

## Design Direction — "Clinical Trust"

- **Palette:** Deep medical navy `#0A1628` / `#0F2847`, crisp white surfaces, electric cyan `#22D3EE` AI accent, supportive emerald for "healthy" states, amber/red for risk.
- **Typography:** Inter (UI) + Instrument Serif accents for hero moments — calm, clinical, premium.
- **Motion:** Subtle parallax on marketing, soft data-viz transitions, AI "shimmer" on suggestion chips.
- **Tone:** Hospital-grade trust + Apple-grade polish. Generous whitespace, precise grids, quiet luxury.

---

## Architecture Overview

```text
                ┌─────────────────────────────────┐
                │   Public Marketing + Booking     │  (anyone)
                └────────────────┬────────────────┘
                                 │
                ┌────────────────┴────────────────┐
                │       Lovable Cloud Auth         │  email + Google
                │     + user_roles (RLS)           │
                └────┬──────────────┬──────────┬──┘
                     │              │          │
              /patient/*      /provider/*   /admin/*
              Patient Portal   Clinician     Ops Console
                               Workspace
                     │              │          │
                ┌────┴──────────────┴──────────┴────┐
                │   Postgres (RLS) + Server Funcs    │
                │   AI Gateway (Lovable AI)          │
                └────────────────────────────────────┘
```

---

## Phase 1 Deliverables

### 1. Marketing + Identity (`/`)
- Hero with the AHOS positioning, animated gradient, trust badges (HIPAA-ready, SOC2-track, Zero Trust).
- Sections: Problem → Platform pillars → How AI scheduling works → Security model → Personas → CTA.
- Separate routes: `/about`, `/security`, `/for-providers`, `/contact`, each with proper SEO `head()`.

### 2. Authentication & Roles
- Email/password + Google sign-in via Lovable Cloud.
- `app_role` enum: `patient | provider | admin` in a separate `user_roles` table with `has_role()` security-definer function (no role-on-profile anti-pattern).
- `profiles` table auto-created via trigger on signup; role chosen at onboarding (admin role gated — assigned manually or first-user bootstrap).
- `_authenticated` layout route with `beforeLoad` redirect; role-specific layouts `_patient`, `_provider`, `_admin`.

### 3. Patient Portal (`/patient/*`)
- **Discover & Book:** Searchable provider directory (specialty, location, insurance, availability) with filter chips and AI "best match" ranking.
- **AI-Assisted Scheduling:** Natural-language box ("I need a dermatologist next week, mornings only") → Lovable AI proposes 3 ranked slots with reasoning.
- **Booking flow:** Slot pick → reason for visit → confirm → confirmation screen with calendar add.
- **My Appointments:** Upcoming/past, join telemedicine, cancel/reschedule.
- **Profile & insurance** basics.

### 4. Provider Workspace (`/provider/*`)
- **Today dashboard:** Next patient card, day timeline, no-show risk badges (heuristic v1: history + lead time + channel), quick actions.
- **Schedule:** Week calendar with drag-to-block availability; appointment detail drawer.
- **Patient queue:** Waiting / in-room / completed lanes.
- **Patient context panel:** Demographics, prior visits, AI-summarized notes (stub).

### 5. Admin Operations Console (`/admin/*`)
- KPI strip: bookings today, utilization %, no-show rate, avg wait, revenue proxy.
- Charts (Recharts): bookings trend, capacity heatmap by hour×day, no-show risk distribution, top specialties.
- Provider roster management, role assignment, audit log viewer.

### 6. Telemedicine Room Shell (`/consult/$appointmentId`)
- Pre-call device check UI, in-call layout (local + remote video tiles, mute/cam/share/end), side panel with **AI Scribe (stub)** that streams placeholder transcript + structured SOAP note skeleton via Lovable AI on demand.
- WebRTC wired with `getUserMedia` for self-preview; full peer signaling marked as Phase 2.

### 7. Security Posture (built-in, not bolted-on)
- RLS on every table; policies via `has_role()`.
- Server functions for all writes via `requireSupabaseAuth`; admin client only in trusted server paths.
- Zod validation on every server function input (length caps, formats).
- HIBP leaked-password protection enabled.
- Audit log table (`audit_events`) — every booking/role change inserted server-side; admin viewer included. (Hash-chain "blockchain-style" integrity is Phase 2.)
- Security memory document seeded.

---

## Data Model (Phase 1)

```text
profiles(id PK→auth.users, full_name, dob, phone, avatar_url, ...)
user_roles(id, user_id, role app_role)             -- RLS, has_role()
providers(id, user_id, specialty, bio, photo, rating, location, ...)
provider_availability(id, provider_id, weekday, start, end)
appointments(id, patient_id, provider_id, starts_at, ends_at,
             status, reason, channel, no_show_risk numeric)
audit_events(id, actor_id, action, entity, entity_id, meta jsonb, created_at)
```

RLS summary:
- patients: read/write own profile + own appointments
- providers: read assigned appointments, manage own availability
- admins: full read; writes via server functions only

---

## Routes (TanStack Start, file-based)

```text
src/routes/
  __root.tsx
  index.tsx                  /
  about.tsx, security.tsx, for-providers.tsx, contact.tsx
  login.tsx, signup.tsx, onboarding.tsx
  _authenticated.tsx                             (auth gate)
    _authenticated/_patient.tsx                  (role gate + shell)
      _authenticated/_patient/dashboard.tsx
      _authenticated/_patient/discover.tsx
      _authenticated/_patient/book.$providerId.tsx
      _authenticated/_patient/appointments.tsx
      _authenticated/_patient/profile.tsx
    _authenticated/_provider.tsx
      _authenticated/_provider/today.tsx
      _authenticated/_provider/schedule.tsx
      _authenticated/_provider/queue.tsx
      _authenticated/_provider/patients.tsx
    _authenticated/_admin.tsx
      _authenticated/_admin/overview.tsx
      _authenticated/_admin/providers.tsx
      _authenticated/_admin/audit.tsx
    _authenticated/consult.$appointmentId.tsx
```

---

## AI (Lovable AI Gateway, default `google/gemini-3-flash-preview`)

- `suggestSlots` server fn — structured tool-call output ranking 3 slots with reasoning.
- `summarizeIntake` — turns patient's free-text reason into a short clinical summary for the provider card.
- `scribeDraft` — generates SOAP-format note skeleton from a placeholder transcript in the consult room.

All prompts live server-side; 402/429 errors surfaced as toasts.

---

## Explicitly Out of Scope (Phase 2+)

To set expectations honestly: full WebRTC peer signaling + TURN, ambient real-time scribe, voice/WhatsApp omnichannel agent, true ML no-show model (we ship a transparent heuristic with a clean swap point), blockchain hash-chain audit, WebAuthn/biometrics, PWA offline sync, EHR/FHIR integrations, payments. The architecture, data model, and UI surfaces are designed so each can drop in without rework.

---

## Build Order

1. Design tokens (HSL) + base layout primitives.
2. Database schema + RLS + roles + triggers.
3. Auth (email + Google) + onboarding + role-gated layouts.
4. Marketing site (index + sub-routes) with hero, sections, SEO.
5. Patient portal end-to-end (discover → AI suggest → book → confirm → list).
6. Provider workspace (today + schedule + queue + patient panel).
7. Admin console (KPIs + charts + audit + provider mgmt).
8. Telemedicine room shell + AI scribe stub.
9. Security pass (RLS audit, HIBP, security memory, scan).

Approve this and I'll start building.
