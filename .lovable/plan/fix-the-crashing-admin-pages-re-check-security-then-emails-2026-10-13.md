# Fix the crashing admin pages, re-check security, then emails

Your screenshots show a series of admin pages crashing on the preview link: Bookings, CHW mesh, Audit log, Notifications, Resend email and Data retention. The CHW queue errors and Scan diff rejects its data. The same pages loaded in my own browser test on Oct 11, so the cause is something that differs between that test and the preview link. I haven't confirmed what it is yet, so step 1 is to find it before changing anything.

## 1. Find out why the pages crash (first)
- Open each crashing page in a browser signed in as alvo4breezy@gmail.com: through the menu and by typing the address, on both my test copy and the preview link. Record the exact error and what the app's server sent back.
- Errors like "reading 'length'" and "reading 'map'" mean a page received no data where it expected a list. Likely causes, in order to check:
  - the security check on signed-in actions rejecting requests on the preview link
  - a changed sign-in check
  - a server error that comes back blank
- Fix the confirmed cause at its source. Make the same fix in every place that shares it, not page by page.

## 2. Make every admin page fail gracefully
- If data fails to load, the page shows a clear message and a "Try again" button instead of "Something went wrong". This covers Bookings, CHW mesh, CHW queue, Audit log, Notifications, Resend email, Data retention and Scan diff.
- Scan diff: compare what the server sends with what the page expects, and fix whichever side is wrong.

## 3. Typed page addresses land on the right page
- Typing a page address while signed in, for example /app/admin/bookings, currently lands on the main app page. Fix it so it opens that page.
- Check: open 10 admin addresses directly by typing them and confirm each one loads.

## 4. Security re-check
- Run a new security scan. Confirm the five issues fixed on Oct 13 no longer appear. If any is still there, fix it again.
- Report any new findings to you, with a suggested fix for each. They won't be changed unless you pick them, since earlier you asked that only selected findings be touched.
- Add automatic checks for the five fixes:
  - sign-in redirect rejects outside sites
  - cleanup endpoint rejects the public key
  - community workers see only their own tasks
  - providers can only assign tasks to their own patients
  - the notifications CSV keeps formulas as plain text

## 5. Emails (blocked until your sender domain is added)
No sender domain is set up yet. Once you finish **Set up email domain**:
- Turn on email sending for the project.
- **Export finished / failed** emails, sent to the address entered when queuing an export.
- **Booking confirmation** to the patient right after Confirm booking, sent once even if retried.
- **Admin alerts**, one email per admin:
  - each new booking
  - security sync spikes: 5 or more blocked or failed attempts in 15 minutes, at most one alert per hour
- Branded unsubscribe page.
- Real tests to alvo4breezy@gmail.com: queue a findings export, make a test booking, trigger an alert, then confirm each email shows as sent in the delivery log.

Until the domain exists, step 5 is not started.

## Technical notes
- Diagnosis: run Playwright against localhost and the preview URL with a minted admin session, and capture the `/_serverFn` responses (status and body). Check `csrf-middleware.ts` and `auth-attacher` behaviour on that host. Read server logs for both deployments.
- Server functions return `{ items: [], error }` shapes. Pages default every list to `[]` before calling `.map`/`.length`.
- Direct-URL fix: `app.tsx` `beforeLoad` runs during SSR, where no session is available. Make the `/app` layout `ssr: false`, or move the session gate to the client, so a hard load waits for the session instead of redirecting.
- New vitest cases go under `tests/security/`.
