// Contract tests for the security admin API surface.
//
// These pin the response schemas and pagination metadata the UI depends on.
// The pure assertions always run; the live-schema assertions run only when
// service-role credentials are present.
//
// Run with: bun run test:metrics-contract
import { createClient } from "@supabase/supabase-js";
import {
  SecuritySyncMetricsResponseSchema,
  SecuritySyncAttemptSchema,
  SecurityFindingSchema,
  SecurityFindingAuditRowSchema,
  FindingsExportResponseSchema,
  AuditExportResponseSchema,
  AttemptsExportResponseSchema,
  ScanDiffResponseSchema,
  PaginationSchema,
  buildPagination,
} from "@/lib/security-contracts";
import { formatSecurityEvent, parseSentryDsn, sentryStoreTarget } from "@/lib/telemetry";

let passed = 0;
let failed = 0;
const ok = (l: string) => { passed++; console.log(`  ✅ ${l}`); };
const bad = (l: string, d?: string) => { failed++; console.log(`  ❌ ${l}${d ? " — " + d : ""}`); };

console.log("\n▶ security contracts (schemas, pagination, telemetry)\n");

// ---------------------------------------------------------------- pagination
{
  const p = buildPagination(1201, 2, 500);
  PaginationSchema.parse(p);
  p.pages === 3 ? ok("pagination: 1201 rows @500 = 3 pages") : bad("pagination pages", String(p.pages));
  p.hasMore === true ? ok("pagination: page 2 of 3 hasMore=true") : bad("pagination hasMore on middle page");
  const last = buildPagination(1201, 3, 500);
  last.hasMore === false ? ok("pagination: last page hasMore=false") : bad("pagination hasMore on last page");
  const empty = buildPagination(0, 1, 500);
  empty.pages === 0 && empty.hasMore === false ? ok("pagination: empty result set clamps to 0 pages") : bad("pagination empty set");
  const exact = buildPagination(1000, 2, 500);
  exact.pages === 2 && exact.hasMore === false ? ok("pagination: exact multiple has no extra page") : bad("pagination exact multiple");
}

// ------------------------------------------------------- export envelope shape
{
  const envelope = { error: null, rows: [], pagination: buildPagination(0, 1, 500) };
  const checks: [string, { safeParse: (v: unknown) => { success: boolean } }][] = [
    ["findings export", FindingsExportResponseSchema],
    ["audit export", AuditExportResponseSchema],
    ["attempts export", AttemptsExportResponseSchema],
  ];
  for (const [label, schema] of checks) {
    schema.safeParse(envelope).success ? ok(`${label}: empty envelope matches contract`) : bad(`${label}: empty envelope`);
  }
  const denied = { error: "Forbidden", rows: [], pagination: buildPagination(0, 1, 500) };
  FindingsExportResponseSchema.safeParse(denied).success
    ? ok("export: Forbidden envelope still matches contract (rows empty)")
    : bad("export Forbidden envelope");
  const leaky = { error: "Forbidden", rows: [{ id: "x" }], pagination: buildPagination(1, 1, 500) };
  FindingsExportResponseSchema.safeParse(leaky).success === false
    ? ok("export: malformed row rejected by contract")
    : bad("export malformed row accepted");
}

// ------------------------------------------------------------------ scan diff
{
  const diff = { error: null, latestScanAt: null, previousScanAt: null, resolved: [], remaining: [], newlyIntroduced: [], reports: [] };
  ScanDiffResponseSchema.safeParse(diff).success ? ok("scan diff: empty response matches contract") : bad("scan diff empty response");
  const missingBucket = { ...diff } as Record<string, unknown>;
  delete missingBucket["newlyIntroduced"];
  ScanDiffResponseSchema.safeParse(missingBucket).success === false
    ? ok("scan diff: missing bucket rejected")
    : bad("scan diff missing bucket accepted");
}

// ------------------------------------------------------------------ telemetry
{
  const line = formatSecurityEvent({ event: "security.sync.rate_limited", severity: "warning", attrs: { source_ip: "203.0.113.9", dropped: undefined, count: 31 } });
  line.channel === "security" && line.event === "security.sync.rate_limited" ? ok("telemetry: structured line carries channel + event") : bad("telemetry line shape");
  !("dropped" in line.attrs) && line.attrs["count"] === 31 ? ok("telemetry: undefined attrs stripped") : bad("telemetry attr cleaning");
  JSON.parse(JSON.stringify(line)) ? ok("telemetry: line is JSON-serializable") : bad("telemetry serialization");
  parseSentryDsn("not-a-dsn") === null ? ok("telemetry: invalid DSN is a no-op") : bad("telemetry invalid DSN");
  const dsn = parseSentryDsn("https://abc123@o1.ingest.sentry.io/4505");
  dsn && sentryStoreTarget(dsn).url === "https://o1.ingest.sentry.io/api/4505/store/"
    ? ok("telemetry: DSN maps to the Sentry store endpoint")
    : bad("telemetry DSN parsing", JSON.stringify(dsn));
}

// ------------------------------------------------------------ live DB schemas
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.log("  ⏭  live schema checks skipped (SUPABASE_SERVICE_ROLE_KEY not set)");
} else {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const { data: metrics, error: mErr } = await admin
    .from("security_sync_metrics_daily" as never)
    .select("day, status, count, bytes, avg_duration_ms, last_seen")
    .gte("day", since)
    .order("day", { ascending: false });
  if (mErr) bad("live: metrics view read", mErr.message);
  else {
    const res = SecuritySyncMetricsResponseSchema.safeParse({ error: null, metrics: metrics ?? [], topIps: [] });
    res.success ? ok(`live: metrics view matches contract (${(metrics ?? []).length} rows)`) : bad("live metrics contract", JSON.stringify(res.error?.issues?.[0]));
  }

  const tableChecks = [
    ["security_sync_attempts", SecuritySyncAttemptSchema, "received_at"],
    ["security_findings", SecurityFindingSchema, "last_seen_at"],
    ["security_finding_audit", SecurityFindingAuditRowSchema, "created_at"],
  ] as const;
  for (const [table, schema, orderCol] of tableChecks) {
    const { data, error } = await admin.from(table as never).select("*").order(orderCol, { ascending: false }).limit(20);
    if (error) { bad(`live: ${table} read`, error.message); continue; }
    const rows = (data ?? []) as unknown[];
    if (rows.length === 0) { ok(`live: ${table} empty (contract vacuously satisfied)`); continue; }
    const issues = rows.map((r) => schema.safeParse(r)).filter((r) => !r.success);
    issues.length === 0
      ? ok(`live: ${table} rows match contract (${rows.length} sampled)`)
      : bad(`live: ${table} contract drift`, JSON.stringify(issues[0]?.error?.issues?.[0]));
  }
}

console.log(`\n${failed === 0 ? "✅" : "❌"} contracts: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
