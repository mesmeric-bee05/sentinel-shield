// Export-job + realtime-backfill regression suite.
//
// Covers:
//  1. runExportJob drives a job row queued -> running -> complete, stores the
//     payload, and reports progress/total rows.
//  2. Job payload serialization matches the dataset column contract (CSV header
//     + row count) and JSON round-trips.
//  3. RLS: anonymous callers cannot read security_export_jobs.
//  4. Watermark backfill logic detects scans missed while disconnected.
//
// Run with: bun run test:export-jobs
import { createClient } from "@supabase/supabase-js";
import { runExportJob, serializeRows } from "@/lib/security-export-jobs.server";
import { isStale, advanceWatermark } from "@/lib/scan-watermark";
import { sentrySearchUrl } from "@/lib/sentry-link";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

let passed = 0;
let failed = 0;
const ok = (l: string) => { passed++; console.log(`  ✅ ${l}`); };
const bad = (l: string, d?: string) => { failed++; console.log(`  ❌ ${l}${d ? " — " + d : ""}`); };

console.log("\n▶ security export jobs + diff backfill\n");

// --- pure logic: watermark ---------------------------------------------------
isStale(null, "2026-01-01T00:00:00Z") ? ok("stale when nothing rendered yet") : bad("stale when nothing rendered yet");
isStale("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z") ? ok("stale when server ahead (missed scan)") : bad("stale when server ahead");
!isStale("2026-01-03T00:00:00Z", "2026-01-02T00:00:00Z") ? ok("not stale when server behind") : bad("not stale when server behind");
!isStale("2026-01-03T00:00:00Z", null) ? ok("not stale when server has no scans") : bad("not stale when server empty");
advanceWatermark("2026-01-01T00:00:00Z", "2026-01-05T00:00:00Z") === "2026-01-05T00:00:00Z"
  ? ok("watermark advances to newest") : bad("watermark advances to newest");
advanceWatermark("2026-01-09T00:00:00Z", "2026-01-05T00:00:00Z") === "2026-01-09T00:00:00Z"
  ? ok("watermark never moves backwards") : bad("watermark never moves backwards");

// --- pure logic: sentry links ------------------------------------------------
sentrySearchUrl("abc", null, null) === null ? ok("no Sentry link without org config") : bad("no Sentry link without org config");
(sentrySearchUrl("abc123", "acme", "web") ?? "").includes("correlation_id%3Aabc123")
  ? ok("Sentry link carries the correlation ID") : bad("Sentry link carries the correlation ID");
sentrySearchUrl(null, "acme", "web") === null ? ok("no Sentry link without correlation ID") : bad("no Sentry link without correlation ID");

// --- pure logic: serialization ----------------------------------------------
{
  const rows = [{ internal_id: "x1", scanner_name: "wiz", title: "T,1", severity: "error", resource: "r", status: "open", first_seen_at: "a", last_seen_at: "b" }];
  const csv = serializeRows("security_findings", rows, "csv");
  csv.split("\n")[0]?.startsWith("Internal ID,Scanner,Title") ? ok("CSV header follows the dataset contract") : bad("CSV header", csv.split("\n")[0]);
  csv.includes('"T,1"') ? ok("CSV escapes embedded commas") : bad("CSV escapes embedded commas");
  JSON.parse(serializeRows("security_findings", rows, "json")).length === 1 ? ok("JSON round-trips rows") : bad("JSON round-trips rows");
}

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.log("\n⏭  Skipping DB-backed checks: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.");
} else {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Need a real user id for requested_by (FK to auth.users).
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  const userId = users?.users?.[0]?.id;

  if (!userId) {
    console.log("⏭  Skipping DB-backed checks: no auth users available.");
  } else {
    const { data: job, error: insErr } = await admin
      .from("security_export_jobs")
      .insert({ requested_by: userId, dataset: "security_findings", format: "csv", filters: {}, status: "queued", correlation_id: "test-correlation" })
      .select("id")
      .single();

    if (insErr || !job) {
      bad("queue an export job", insErr?.message);
    } else {
      ok("queue an export job");
      const result = await runExportJob({
        admin: admin as never,
        jobId: job.id,
        dataset: "security_findings",
        format: "csv",
        filters: {},
      });
      result.status === "complete" ? ok("job runs to completion") : bad("job runs to completion", result.error ?? "");

      const { data: done } = await admin
        .from("security_export_jobs")
        .select("status, progress_rows, total_rows, result_payload, result_bytes, finished_at")
        .eq("id", job.id)
        .single();
      done?.status === "complete" ? ok("job row marked complete") : bad("job row marked complete", String(done?.status));
      (done?.result_payload ?? "").length > 0 ? ok("payload stored for later download") : bad("payload stored for later download");
      done?.finished_at ? ok("finished_at recorded") : bad("finished_at recorded");
      (done?.progress_rows ?? -1) === result.rowCount ? ok("progress matches collected rows") : bad("progress matches collected rows");

      // RLS: anonymous must not see export jobs.
      if (ANON_KEY) {
        const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
        const { data: leak, error: anonErr } = await anon.from("security_export_jobs").select("id").limit(1);
        (!leak || leak.length === 0) ? ok(`anonymous cannot read export jobs${anonErr ? " (denied)" : ""}`) : bad("anonymous cannot read export jobs", `${leak.length} rows leaked`);
      }

      await admin.from("security_export_jobs").delete().eq("id", job.id);
    }
  }
}

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
