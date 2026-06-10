## Implementation plan

### 1. Clear the remaining import-protection/build errors
- Move client-imported server functions out of `src/server/*` into client-safe `src/lib/*.functions.ts` modules, starting with the confirmed email preview error.
- Update route/component imports to the new locations for the touched flows: GSC, SEO audit, email-domain wizard, CHW queue, booking, contact preferences, appointments, and email preview.
- Keep server-only helpers and admin client usage inside server function handlers so secrets never reach the browser bundle.
- Confirm authenticated server calls have the auth-attacher startup wiring if this project needs an explicit `src/start.ts` entry.

### 2. GSC connect, verification, retry, and republish history UI
- Enhance the GSC page with clear states for: connector missing, token missing, meta tag not deployed, verification failed, sitemap/URL republish failed, and verified/healthy.
- Add an explicit Retry button for connect/token/verify/republish failures.
- Add one automatic retry with a short delay for transient failures such as network or 5xx responses, including republish failure after verification.
- Load and display the existing republish log as an admin history panel with timestamp, action type, status, HTTP status, duration, site URL, and result/error details.
- Add manual “Resubmit sitemap” and “Resubmit URL” actions where supported by the existing connector path, and log each attempt.

### 3. Email-domain wizard live diagnostics and delivery switch confirmation
- Expand the wizard’s DKIM/SPF/DMARC diagnostics to show expected record, observed values, pass/warn/fail reason, and last checked time.
- Keep NS/MX checks visible as supporting infrastructure diagnostics without hiding the requested DKIM/SPF/DMARC status.
- Display persisted `live_since_at` and delivery-mode audit history so admins see the exact timestamp booking confirmations switched from sandbox preview to real delivery.
- Ensure auto-switch is recorded as an auto-live audit event, not only a generic manual mode change.

### 4. SEO audit run history, section progress, and export
- Wire the SEO audit page to `listSeoAuditRuns` and show the latest runs with last-run timestamp, duration, and pass/warn/fail counts.
- Add per-section rerun progress indicators while an audit is running, instead of only one global progress bar.
- Add export options for the latest result as JSON and CSV.
- Improve error handling around Lighthouse/PageSpeed and published-page fetches so failed sections show clear warnings instead of breaking the page.

### 5. Fix CHW queue crash and improve patient/CHW contact
- Fix `/app/chw` so non-CHW patients see a friendly empty state instead of the generic error page.
- Harden CHW assignment rendering against missing task types, missing CHW joins, and query errors.
- Add contact actions using available phone fields: call/text buttons for CHWs and clinicians when phone is available, and safe in-app/contact fallback when it is not.
- If provider phone is not currently stored, surface the fallback cleanly and avoid inventing unavailable phone data.

### 6. Ensure booking button works reliably
- Update the booking dialog so the Confirm button never appears silently stuck.
- Show the exact blocking reason when waiting for slot hold, AI summary, expired hold, or conflict.
- Add a retry-reserve action and a “confirm without AI summary” fallback so patients can proceed when AI summarization fails or stalls.
- Keep final server-side conflict checks and hold validation in place for security.

### 7. Validation pass
- Run the relevant automated checks after implementation.
- Use preview signals for the CHW screenshot issue and verify `/app/chw` no longer shows the generic “Something went wrong” page.
- Verify the admin GSC, email-domain, SEO audit, appointments, discover/booking, and email preview pages render without import-protection errors.