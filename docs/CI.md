# CI

Two workflows live under `.github/workflows/`:

- `ci.yml` — runs on every PR + push to `main`. Installs deps, builds
  production, then runs the security + test suites sequentially so any
  failure logs verbatim in the job output.
- `security-scan.yml` — same triggers plus a nightly cron. Fails the
  build if any pinned `internal_id` is open in `security_findings`.
  The list of gated findings lives in `scripts/ci/security-gate.ts`.

## Local reproduction

```
bun install --frozen-lockfile
bun run build
bun run test:security
bun run test:rls-regression
bun run test:security-sync
bun run test:scope-regression
bun run test:requeue-parity
bun run test:chw-requeue-e2e
bun run scripts/ci/security-gate.ts
```

Each suite prints its own `N passed, N failed` summary and exits non-zero
on failure.

## Required GitHub secrets

| Secret | Used by | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | all suites, gate | Data API base URL |
| `SUPABASE_PUBLISHABLE_KEY` | anon-role RLS tests | Anon key for policy checks |
| `SUPABASE_SERVICE_ROLE_KEY` | RLS + parity + e2e + gate | Provisions ephemeral users, seeds/cleans |
| `SECURITY_SYNC_SECRET` | security-sync suite | HMAC signing for the webhook |

If any of the four is missing, the affected suite prints `⏭ Skipping …`
and exits 0 so forks without secrets don't fail the build.

## Extending the gate

Add another `internal_id` to `PINNED` in `scripts/ci/security-gate.ts`
after a finding is fixed. The next PR will fail if it regresses.
