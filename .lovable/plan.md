
## Goal

Wire the existing email + SEO surfaces into a single, guided flow so an admin can: (1) verify a sender domain end-to-end with live DKIM/SPF/DMARC status, (2) authorize Google Search Console and push the sitemap from inside the app, and (3) see a stronger pass/fail SEO checklist. The `/app/admin/seo-audit` and `/app/admin/email-health` pages already exist — this plan extends them and adds a new wizard route.

## What gets built

### 1. Sender-domain setup wizard — `/app/admin/email-domain`
A 4-step wizard that wraps the Lovable email-domain tooling and the existing sandbox-preview page so admins move from "no domain" → "real delivery" without leaving the app.

Steps:
1. **Choose subdomain** (e.g. `notify.apexcare.ai`) — opens the Lovable email-setup dialog via `<presentation-open-email-setup>`.
2. **DNS records** — pulls the records (NS / SPF / DKIM / DMARC) from `email_domain--check_email_domain_status` and renders each with a copy button.
3. **Live verification** — auto-polls a new server fn `getEmailDomainStatus` every 8s; shows per-record status badges (Pending / Verifying / Verified / Failed) plus an overall progress bar. Stops polling once `active` or after 10 min.
4. **Activate real delivery** — once `active`, flips a `delivery_mode` row in a new `email_settings` table from `sandbox` → `live`. `bookAppointment` already enqueues to the notification pipeline; it reads `email_settings.delivery_mode` and, in sandbox, writes `email.sandbox_preview` audit events instead of calling the queue. Toggling here switches future bookings to real sends automatically — no code edit needed.

### 2. Google Search Console integration — `/app/admin/seo/gsc`
- Uses the existing `google_search_console` connector via `standard_connectors--connect` from the UI (link button surfaces the connection picker).
- Server fn `verifyAndSubmitSite` runs the META-token flow against the connector gateway:
  1. Inject the Google site-verification `<meta>` tag into `__root.tsx` head via a small `gscToken` row in the new `seo_settings` table (so it ships on the next publish without a code edit per token).
  2. POST `/siteVerification/v1/token` → store token → prompt user to **Republish**.
  3. After republish, POST `/siteVerification/v1/webResource?verificationMethod=META` to verify, then `PUT /webmasters/v3/sites/<encoded url>` to add the property, then submit the sitemap via `PUT /webmasters/v3/sites/<url>/sitemaps/<sitemap-url>`.
- Page shows: connection state, token status, verification status, sitemap submission status, last submitted timestamp.

### 3. SEO audit upgrade — `/app/admin/seo-audit`
Extend the existing page:
- Replace ad-hoc fetch checks with a typed `runSeoAudit` server fn that returns a structured `{ id, label, category, status, detail, severity }[]`.
- Add categories: **Meta**, **Open Graph**, **JSON-LD**, **Sitemap/robots**, **GSC**, **Lighthouse**.
- GSC row reads live state from the `seo_settings` table + a gateway call to confirm the property is still verified.
- Lighthouse row pings the published URL's PageSpeed Insights API (no key needed for the free tier) and surfaces the contrast + performance score.
- Big **Rerun audit** button (already present) is kept; add per-row "Recheck" affordance and a top-of-page pass/fail summary (`x of y passing`).

## Technical details

**New files**
- `src/routes/app.admin.email-domain.tsx` — wizard UI.
- `src/routes/app.admin.seo.gsc.tsx` — GSC flow UI.
- `src/server/email-domain.functions.ts` — `getEmailDomainStatus`, `setDeliveryMode`. Wraps `email_domain--check_email_domain_status` results into a serializable shape for the client poller.
- `src/server/seo.functions.ts` — `runSeoAudit`, `getGscState`, `requestGscToken`, `verifyAndSubmitSite`.
- `supabase/migrations/<ts>_email_seo_settings.sql` — creates:
  - `public.email_settings(id int pk default 1, delivery_mode text check in ('sandbox','live') default 'sandbox', sender_domain text, updated_at timestamptz)`
  - `public.seo_settings(id int pk default 1, gsc_meta_token text, gsc_verified_at timestamptz, gsc_sitemap_submitted_at timestamptz, updated_at timestamptz)`
  - `GRANT`s + RLS: admin-only via `has_role(auth.uid(),'admin')`; `service_role` full access.

**Edits**
- `src/routes/__root.tsx` head() — read `seo_settings.gsc_meta_token` at SSR via a tiny loader and inject `<meta name="google-site-verification">` when present.
- `src/server/appointments.functions.ts` — branch on `email_settings.delivery_mode` (sandbox → audit only, live → enqueue). Today's behavior already audits; this only adds the real-send branch.
- `src/routes/app.tsx` sidebar — add "Email domain" and "Search Console" entries under the existing admin section.
- `src/routes/app.admin.seo-audit.tsx` — swap to the new server fn, add categories + per-row recheck.

**Connectors / secrets**
- Triggers `standard_connectors--connect` for `google_search_console` only when the admin clicks "Connect" on the GSC page.
- No new user-supplied secrets. Lovable Email and GSC connector handle credentials.

**Out of scope** (call out, don't build)
- Custom DMARC policy editor — surface the recommended record only.
- Per-record DNS auto-fix at the registrar — Lovable's NS delegation already handles records once NS is set.
- Lighthouse historical tracking — only the current score is shown.

## Open questions

1. For the GSC sitemap submission, should I also schedule a daily resubmit (via a `/api/public/cron/*` endpoint) or is one-shot on-publish enough?
2. Once `delivery_mode='live'`, do you want a per-template kill switch (e.g. pause booking emails while keeping auth emails live), or is the global flag fine for v1?
