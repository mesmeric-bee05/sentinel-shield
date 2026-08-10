# Telemetry & structured log taxonomy

All security-relevant events are emitted through `emitSecurityEvent` /
`emitSecurityEventAsync` in `src/lib/telemetry.ts`. Every event is written as a
single-line JSON log and, when `SENTRY_DSN` is set, forwarded to Sentry's store
endpoint over plain `fetch` (no SDK, Worker-safe).

## Log line shape

```json
{
  "ts": "2026-08-09T10:00:00.000Z",
  "channel": "security",
  "event": "security.sync.rate_limited",
  "severity": "warning",
  "message": "security.sync.rate_limited",
  "attrs": { "ip": "203.0.113.4", "bytes": 812 }
}
```

Fields:

| Field      | Required | Notes |
|------------|----------|-------|
| `ts`       | yes      | ISO-8601 UTC, set by the emitter |
| `channel`  | yes      | always `security` for this taxonomy |
| `event`    | yes      | dot-namespaced name from the table below |
| `severity` | yes      | `info` \| `warning` \| `error` |
| `message`  | yes      | human string; defaults to `event` |
| `attrs`    | yes      | flat map of string/number/boolean/null only |

`undefined` attributes are dropped. Never put PHI, tokens, or raw payload bodies
in `attrs`.

## Event names

### Security-sync webhook (`src/routes/api/public/security-sync.ts`)

| Event | Severity | Required attrs |
|-------|----------|----------------|
| `security.sync.accepted` | info | `bytes`, `findings`, `duration_ms`, `ip` |
| `security.sync.rate_limited` | warning | `ip`, `window_ms` |
| `security.sync.payload_too_large` | warning | `bytes`, `limit`, `ip` |
| `security.sync.invalid_signature` | error | `ip`, `nonce` |
| `security.sync.replay` | warning | `nonce`, `ip` |
| `security.sync.write_failed` | error | `error`, `findings` |

### Admin exports (`src/lib/security.functions.ts`)

| Event | Severity | Required attrs |
|-------|----------|----------------|
| `security.export.completed` | info | `dataset`, `user_id`, `rows`, `total`, `page`, `duration_ms` |
| `security.export.denied` | warning | `dataset`, `user_id` |
| `security.export.failed` | error | `dataset`, `error` |

Every export run (page 1 of a paginated download) also writes a durable row to
`public.security_export_audit`: actor, kind, format, filters, scan window, row
count and duration. That table is admin-read-only and is the auditable record;
logs are the operational signal.

### CI notifier (`scripts/ci/notify-security.ts`)

| Event | Severity | Required attrs |
|-------|----------|----------------|
| `security.notify.retry` | warning | `channel`, `attempt`, `delay_ms`, `error` |
| `security.notify.failed` | error | `channel`, `attempts`, `error` |
| `security.notify.sent` | info | `channel`, `attempts` |

The notifier never fails the gate job; transport failures are logged only.

## Sentry correlation

Each forwarded event carries:

- `event_id` — random 32-char hex generated per emit; this is the correlation ID
  to quote when cross-referencing a log line with a Sentry issue.
- `tags.event` — the event name above (use for alert rule filters).
- `tags.channel` — always `security`.
- `extra` — the same flat `attrs` map as the log line.
- `environment` — `SENTRY_ENVIRONMENT`, else `NODE_ENV`, else `production`.

## Recommended Sentry alert rules

Create these in Sentry (Alerts → Create Alert → Number of events):

1. **Sync rate limiting spike** — filter `tags.event:security.sync.rate_limited`,
   trigger when count > 20 in 5 minutes.
2. **Payload too large spike** — filter
   `tags.event:security.sync.payload_too_large`, trigger when count > 5 in
   10 minutes.
3. **Signature failures** — filter `tags.event:security.sync.invalid_signature`,
   trigger on count >= 1 in 5 minutes (critical: page on-call).
4. **Notifier retry failures** — filter `tags.event:security.notify.failed`,
   trigger on count >= 1 in 15 minutes.
5. **Export denials** — filter `tags.event:security.export.denied`, trigger when
   count > 3 in 1 hour (possible privilege probing).

Add `SENTRY_DSN` (and optionally `SENTRY_ENVIRONMENT`) as project secrets to
activate forwarding; without them logging still works and Sentry is a no-op.

## Sentry alert rules (production paging)

Alert rules are provisioned as code in `scripts/ci/sentry-alerts.ts` and applied
with `bun run sentry:alerts`. Each rule matches on the `event` tag from the
taxonomy above, so renaming an event without updating the script silently
disables paging.

| Rule | Event | Trips at | Window | Re-alert |
|------|-------|----------|--------|----------|
| Security sync rate limiting spike | `security.sync.rate_limited` | 10 events | 5m | 30m |
| Security sync payload too large spike | `security.sync.payload_too_large` | 5 events | 5m | 30m |
| Security notifier retry failures | `notifier.retry_failed` | 3 events | 15m | 60m |

Required environment: `SENTRY_AUTH_TOKEN` (project:write), `SENTRY_ORG`,
`SENTRY_PROJECT`, optional `SENTRY_ENVIRONMENT` and `SENTRY_HOST` (self-hosted).
Without those the script prints the intended rules and exits 0 — it never fails
a pipeline. Re-runs are idempotent: rules are upserted by name.

## Automated coverage

| Suite | What it pins |
|-------|--------------|
| `bun run test:metrics-contract` | metrics response schema + pagination metadata |
| `bun run test:export-rbac` | admin guard, Forbidden verdicts, export audit rows |
| `bun run test:admin-diff-e2e` | scan-diff buckets, realtime refresh, CSV/JSON parity, paging, RBAC |
