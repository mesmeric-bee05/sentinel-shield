# Bookings card, live export check, and email delivery

No sender domain has been added to the project yet, so the email work is split. The two parts below that don't need email are built now. The email part starts once you've finished the domain setup.

## Part 1 — Build now (no domain needed)

1. **Bookings summary card on the Operations dashboard**
   - Shows bookings made today, bookings coming up in the next 7 days, and today's cancellations.
   - Lists the 5 most recent bookings (patient, provider, time, status).
   - Updates by itself when a booking is made or changed.
   - Includes a "View all bookings" link to the Bookings page.
   - Swap the made-up 7-day chart for real booking counts.
2. **Live findings export check** (signed in as alvo4breezy@gmail.com, now an admin)
   - Queue a security findings export from the Export jobs page and watch it go from queued to running to complete.
   - Click Download, open the time-limited link, and save the CSV.
   - Confirm that cells starting with `=`, `+`, `-` or `@` begin with an apostrophe, so they show as plain text and are not run as formulas. Repeat the check on a JSON export converted to CSV.
   - Report back with what was seen. Anything that fails gets fixed and checked again.
3. **Checks**: confirm the app builds, then open the dashboard, Bookings, Export jobs and Data retention pages in a browser as the admin.

## Part 2 — Sender domain (your steps)

1. Click **Set up email domain** and enter a domain you own, like `notify.yourclinic.com`.
2. You'll see 2 records of type **NS** (nameserver). Copy them exactly.
3. At your domain provider, go to DNS settings and add each record:
   - Type: **NS**
   - Name/Host: the part before your main domain (for example `notify`)
   - Value: the nameserver shown, one record per value
4. Save, then go back to Cloud → Emails and click **Verify Domain**. This can take anywhere from a few minutes to 72 hours.
5. If your provider has no NS record type (Shopify is one example), move your DNS to a provider that has it, such as Cloudflare's free plan. The other option is to transfer the domain into Lovable.

## Part 3 — Emails (starts as soon as the domain is added; sending begins once it's verified)

1. Set up email sending for the project.
2. **Export emails**: "export ready" and "export failed" go to the address entered when the export is queued.
3. **Booking confirmation**: sent to the patient right after Confirm booking succeeds. It includes the provider, date and time, the type of visit, and a join or view link. A retry won't send a second copy.
4. **Admin alerts** sent to each admin:
   - **New booking**: one email for each new booking.
   - **Security sync spike**: sent when blocked or failed sync attempts pass a threshold within 15 minutes (default: 5 or more). At most one alert per hour.
5. Unsubscribe page: every app email includes an unsubscribe link, and this is the branded page it opens.
6. **Real test send** to alvo4breezy@gmail.com: one booking confirmation, one export finished email and one admin alert, then confirm in the email delivery log that each was sent.

## Technical notes

- Card: a new admin-gated server function returns the counts, recent rows and a 7-day series. It listens for live updates on `appointments`.
- Export check: a Playwright run using a session minted for user `8f7e48e9…`. It saves the downloaded CSV and checks it with `sanitizeCell` rules. A Vitest parity test stays in place.
- Emails: `setup_email_infra` then `scaffold_transactional_email`. Register the existing `booking-confirmation` and `export-job-status` templates, plus new `admin-new-booking` and `admin-sync-spike` templates.
- Change `notifyExportOutcome` so it enqueues through the service-role send instead of an unauthenticated fetch.
- Trigger the booking confirmation from `bookAppointment` on the server, with idempotency key `booking-confirm-<id>`.
- Spike check runs inside the `/api/public/security-sync` handler after each attempt is logged. Its throttle is tracked through `audit_events`.
- Admin alerts are sent one email per admin; one recipient per send.
