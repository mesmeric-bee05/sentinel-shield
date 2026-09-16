# Fix the broken app flows, then finish the export centre

Two things users hit today are broken (CHW queue, Confirm booking). Those come
first. Then the remaining export/retention work gets finished and verified for
real, end to end.

## 1. Fix the two reported failures

**CHW queue page fails with "Cannot read properties of undefined (reading 'length')"**
The cause is not confirmed yet. First step: sign in against the running app and
reproduce the page, capturing the console and the server response for the queue
request, then fix what the trace actually shows. The page's own loading code and
the queue server call are both in scope; no database change is expected.

**Confirm booking stays disabled on "Reserving slot…"**
Strong suspect, to be confirmed in the same reproduction pass: the dialog
re-runs its slot-reservation step every time the parent re-renders (the provider
and slot values are new objects each render), and each run clears the previously
held slot, so the dialog never leaves the reserving state. Fix by keying the
reservation on stable values (provider id + slot time) rather than object
identity, keeping the current hold while re-checking, and surfacing a clear
error plus a Retry when reservation genuinely fails.

A pass over the booking dialog and CHW queue buttons follows, so every control
either works or explains why it cannot.

## 2. Retention summary on the admin dashboard

Add a card to the operations dashboard showing, per dataset, how long export
audit rows and export job rows are kept, when cleanup last ran and how many rows
it removed, plus the last few cleanup runs and a link to the Data retention page.

## 3. Export jobs page: email alerts

Add an optional "email me when this finishes" choice when queueing an export,
and send a completion or failure notice to the requesting admin through the
existing email setup. Stored per job so the runner knows who to notify.

## 4. End-to-end verification (the part that was never run)

- Run the build, the type check and the security/RLS test suites; fix what fails.
- Queue a real security-findings export against live data through the UI, watch
  it move through queued → running → complete with progress, mint the signed
  link, open it, and confirm the CSV downloads.
- Confirm the downloaded CSV is plain text: any cell starting with `=`, `+`,
  `-`, `@`, tab or carriage return comes back quote-prefixed and inert.
- Convert the same export's JSON output to CSV through the shared sanitising
  helper and assert it is byte-identical to the CSV the job produced, as an
  automated test so it cannot regress.

## 5. Blueprint gap review

Re-read the ApexCare blueprint and development spec, compare against what exists
in the app today, and produce a short written gap list (feature, status, what is
missing) rather than silently starting large new subsystems. Anything already
90% built and broken gets finished in this pass; genuinely new subsystems
(ambient scribe, voice/WhatsApp agent, blockchain audit ledger, offline PWA) are
listed for you to prioritise next, because each is a project in itself.

## Technical notes

- Reproduction uses a browser session against the running app; the CHW fix is
  driven by the captured trace, not by assumption.
- Booking: stabilise the hold effect deps (`provider.id`, `slot.iso`), avoid
  clearing an active hold before the replacement succeeds, keep the existing
  release-on-close and countdown behaviour.
- Dashboard card reads through the existing admin-gated retention config call;
  no new endpoint.
- Email alerts: a `notify_email` column on the export jobs table plus a send in
  the job runner's completion and failure paths, reusing the existing email
  sending path; failures to send never fail the job.
- Verification adds a Vitest case comparing `jsonRowsToCsv` output against the
  job runner's CSV for real findings columns, alongside the live run.
