## Scope

Four concrete deliverables on top of the existing security/CI stack. The uploaded ApexCare blueprint is noted as long-term north star, but this plan only covers what's actionable now — I'll flag blueprint items as follow-ups rather than silently expanding scope.

---

### 1. PR annotations + optional Slack/email alerts for the security-scan gate

Extend `.github/workflows/security-scan.yml` and `scripts/ci/security-gate.ts`:

- Gate script emits **GitHub workflow annotations** (`::error file=...,title=...::message`) for each open pinned `internal_id`, so the finding appears inline on the PR "Files changed" and "Checks" tabs.
- Also write a **job summary** (`$GITHUB_STEP_SUMMARY`) with a markdown table: `internal_id | severity | scanner | last_seen_at | link`. Link points to `/app/admin/security` filtered by that finding.
- Workflow adds a **`pull_request` comment step** (using `actions/github-script`) that upserts a single sticky comment listing reintroduced findings, or deletes it when clean.
- Optional notifiers, gated on repo secrets so forks stay green:
  - `SLACK_SECURITY_WEBHOOK` → post a Slack Block Kit message with the same table + run URL.
  - `SECURITY_ALERT_EMAIL` + existing Resend integration → send a plain-text email via a small `scripts/ci/notify-security.ts`.
- Both notifiers fire **only on `push` to main or scheduled runs** (not every PR) to avoid noise; PRs rely on annotations + sticky comment.

### 2. Expand security-sync replay/timestamp E2E coverage

Extend `tests/security/security-sync.test.ts`:

- **Replay by nonce**: POST a valid signed payload → 200. Re-POST the exact same body/signature → expect 409 `replay`. Query `security_sync_attempts` and assert two rows: first `status='accepted'` with the nonce persisted; second `status='replay'` with `nonce=null` (per current writer) and `error` containing `duplicate nonce`.
- **Stale timestamp**: POST with `issued_at` set to `now - 10min` (outside `REPLAY_WINDOW_MS`) → 400 `invalid_payload: stale issued_at`. Assert an attempt row exists with `status='invalid_payload'`, `signature_valid=true`, and the submitted nonce recorded.
- **Future timestamp**: `now + 10min` → same 400 + attempt row.
- **Signature failure logging** (already partly covered — tighten): assert `status='invalid_signature'`, `signature_valid=false`, `nonce=null`, and that **no `security_findings` upsert** occurred (query count before/after).
- Uses existing service-role client fixtures; cleans up inserted attempts by nonce/source_ip prefix at teardown.

### 3. CSV/JSON export for `security_finding_audit` page

The audit page currently renders read-only. Bring it to parity with other admin history panels:

- Reuse `src/components/admin/HistoryFilters.tsx` (search/from/to/status) and `paginate` / `Pager` helpers.
- Status options: `fixed | ignored | reintroduced`.
- Searchable text: `internal_id`, `scanner_name`, `notes`, joined `affected_endpoints`, joined `affected_queries`.
- CSV columns via `ExportColumn<T>[]` from `src/lib/exports.ts`: `created_at, internal_id, scanner_name, resolution, resolved_by, affected_endpoints (semicolon-joined), affected_queries (semicolon-joined), notes`.
- JSON export = raw filtered rows (unpaged).
- Server function `listSecurityFindingAudit` (in `src/lib/security.functions.ts`) returns up to 1000 rows, admin-gated via `has_role`. Filtering/pagination happens client-side against that page like other panels — matches the requeue-log parity test pattern so a follow-up parity test is trivial.

### 4. Database indexes for hot query paths

Single migration adding indexes that back the rate-limit lookup, replay detection, and export queries.

```text
security_sync_attempts:
  idx_ssa_source_ip_received_at   (source_ip, received_at DESC)   -- rate-limit window scan
  idx_ssa_received_at             (received_at DESC)              -- admin list + export ORDER BY
  idx_ssa_status_received_at      (status, received_at DESC)      -- status filter
  -- nonce already has UNIQUE index (replay); no change

chw_requeue_log:
  idx_crl_created_at              (created_at DESC)               -- default list order + export
  idx_crl_assignment_id           (assignment_id)                 -- per-assignment history
  idx_crl_actor_id_created_at     (actor_id, created_at DESC)     -- "my requeues" scope
  idx_crl_outcome_created_at      (outcome, created_at DESC)      -- failed-only filters
```

All `CREATE INDEX IF NOT EXISTS` (idempotent, safe re-run). No RLS or grant changes.

---

## Technical notes

- No new secrets are required unless the user wires Slack/email — those steps auto-skip when their secrets are absent (same pattern as `security-gate.ts`).
- The audit-page server fn reuses the existing `has_role` admin check and `supabaseAdmin` inside the handler (per server-side rules).
- Indexes are additive; existing queries in `src/routes/api/public/security-sync.ts` (the `count(*) where source_ip=? and received_at>=?` lookup) will pick up `idx_ssa_source_ip_received_at` automatically.

## Out of scope (blueprint follow-ups)

The ApexCare blueprint (AI scribe, WebRTC telemedicine, blockchain audit trail, WebAuthn, omnichannel booking, predictive no-show model, etc.) is much larger than this turn. I'll treat it as a backlog and can plan phase 1 (e.g. WebAuthn on admin routes, or the predictive no-show pipeline) as a separate dedicated plan when you're ready — trying to fold any of it into this turn would bury the four items you asked for.

## Files touched

- Edit: `.github/workflows/security-scan.yml`, `scripts/ci/security-gate.ts`, `tests/security/security-sync.test.ts`, `src/routes/app.admin.security-audit.tsx` (or equivalent audit page), `src/lib/security.functions.ts`
- Create: `scripts/ci/notify-security.ts`, `supabase/migrations/<ts>_hot_path_indexes.sql`
