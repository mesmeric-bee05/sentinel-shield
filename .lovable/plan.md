## Goal

Close three loops already scaffolded in the admin tooling:
1. One-click GSC authorize → verify → sitemap submit from `/app/admin/seo/gsc`, and mark the SEO finding fixed.
2. Email-domain wizard shows a live DNS verification summary and auto-flips to `live` delivery the moment Lovable reports the domain active.
3. SEO audit page shows per-section pass/fail, a running progress indicator on rerun, and a clear last-run timestamp.

No schema changes — `email_settings` and `seo_settings` already exist; `runSeoAudit`, `getEmailDomainSettings`, `checkDnsRecords`, and the GSC server fns are already in place. This is wiring + UX.

## 1. GSC: authorize + auto-republish — `src/routes/app.admin.seo.gsc.tsx` + `src/server/seo.functions.ts`

UI changes:
- Step 1 "Connector status" gets a **Connect Google Search Console** button. When `connected=false`, clicking it triggers the `standard_connectors--connect` flow (surfaced via a chat prompt the user clicks — the admin page deep-links to it with an inline instruction + copy button).
- After `verifyAndSubmitSite` succeeds, immediately:
  - Call a new server fn `markGscFindingFixed` that uses the SEO findings API to mark the GSC finding `fixed` with explanation "Verified ownership and submitted /sitemap.xml via GSC API".
  - Call `verifyAndSubmitSite` once more in "resubmit" mode to push `/sitemap.xml` again (covers the "republish immediately" requirement so the live build's freshly-deployed meta tag is re-scanned).
  - Toast: "Verified, sitemap submitted, SEO finding cleared."
- Show a 4th status card "SEO finding" with pass/fail badge driven by the latest `runSeoAudit` GSC row.

Server changes (`src/server/seo.functions.ts`):
- Add `resubmitSitemap` — thin wrapper that PUTs `/webmasters/v3/sites/<encoded>/sitemaps/<sitemap-url>` and updates `gsc_sitemap_submitted_at`.
- Extend `verifyAndSubmitSite` to also write an `audit_events` row `seo.gsc_verified` for the admin audit log.

## 2. Email-domain wizard: live summary + auto-activate — `src/routes/app.admin.email-domain.tsx`

UI changes:
- Step 3 (verification) renders a compact summary header: **`<n>/5 records verified`** with a `<Progress />` bar over the existing per-record list. Bar color: amber while pending, emerald once `allPass`.
- Polling: keep the 8s interval that calls `checkDnsRecords`. When `allPass` becomes `true` AND `delivery_mode === 'sandbox'`, automatically call `saveEmailDomainSettings({ deliveryMode: 'live' })`, write an `audit_events` row `email.delivery_mode_auto_live`, and toast "Booking confirmations now sending for real."
- Step 4 (Activate) becomes a confirmation panel rather than a manual switch — shows the auto-flip timestamp and an "Undo to sandbox" link.
- Add a "Last checked" timestamp under the summary refreshed every poll.

No server-fn changes needed; `saveEmailDomainSettings` already supports `deliveryMode`.

## 3. SEO audit: rerun progress + per-section status — `src/routes/app.admin.seo-audit.tsx`

UI changes:
- Replace the single `running` flag with `progress: { category, done, total }`. The `runSeoAudit` server fn already returns checks in a known category order; until the response arrives, render a `<Progress />` bar that ticks through the 6 categories on a 600ms timer so the user sees motion (then snaps to 100 % on response).
- Each category section gets a section-level badge **PASS / WARN / FAIL** computed from its rows (worst status wins) and a per-section "Last checked" timestamp.
- Top-of-page summary tiles already exist; add a "Last full run" line above them and a small "Run #N" counter so reruns are visible.
- Per-row "Recheck" affordance from the existing plan is dropped for v1 — the rerun button covers it.

## Technical details

**Edited files**
- `src/routes/app.admin.seo.gsc.tsx` — add 4th card, wire connect prompt, call `markGscFindingFixed` + `resubmitSitemap` after verify.
- `src/server/seo.functions.ts` — add `resubmitSitemap`, `markGscFindingFixed` (calls the SEO findings update endpoint via the same gateway pattern), audit-log additions.
- `src/routes/app.admin.email-domain.tsx` — Progress component, auto-flip effect, summary header.
- `src/routes/app.admin.seo-audit.tsx` — progress state, section badges, last-run timestamp, run counter.

**No DB migration. No connector changes.** The `google_search_console` connector is already linked via the admin's prior session per the seo.functions usage; if not, the GSC page surfaces a clear "Connect" instruction.

**Out of scope** (call out, don't build)
- Scheduled daily sitemap resubmit (Open Q #1 from prior plan).
- Per-template delivery kill switch (Open Q #2).
- Per-row "Recheck" in SEO audit.

## Open question

The "republish" in your request — do you want me to (a) just resubmit the sitemap to GSC after verification (what this plan does, fastest, no rebuild), or (b) trigger an actual frontend republish of the app? (b) requires you to click Publish manually; there is no programmatic publish API.
