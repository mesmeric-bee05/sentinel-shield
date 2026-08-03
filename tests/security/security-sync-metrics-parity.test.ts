// Parity test for the security-sync metrics panel: the numbers rendered by
// MetricsPanel (rollupByDay / rankIps) must match the server metrics response
// exactly, and the attempts table's filters + pagination must match the
// exported rows.
//
// Run with: bun run test:sync-metrics-parity
import { createClient } from "@supabase/supabase-js";
import { rollupByDay, rollupTotals, rankIps } from "@/lib/security-sync-metrics";
import { applyHistoryFilter, paginate, emptyFilters } from "@/components/admin/HistoryFilters";
import { toCsv } from "@/lib/exports";
import type { SecuritySyncDailyMetric, SecuritySyncAttempt } from "@/lib/security.functions";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.log("⏭  Skipping sync-metrics parity: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.");
  process.exit(0);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
const ok = (l: string) => { passed++; console.log(`  ✅ ${l}`); };
const bad = (l: string, d?: string) => { failed++; console.log(`  ❌ ${l}${d ? " — " + d : ""}`); };

const TAG = `metrics-parity-${Date.now()}`;
const testStart = new Date().toISOString();
const STATUSES = ["accepted", "invalid_signature", "replay", "rate_limited"] as const;

console.log(`\n▶ security-sync metrics panel parity (${TAG})\n`);

try {
  // ---- Seed attempts across 4 days and 4 statuses -------------------
  const rows = Array.from({ length: 48 }).map((_, i) => ({
    received_at: new Date(Date.now() - (i % 4) * 86400_000 - i * 1000).toISOString(),
    source_ip: `203.0.113.${(i % 5) + 1}`,
    nonce: `${TAG}-${i}`,
    signature_valid: i % 4 === 0,
    payload_bytes: 100 + i,
    finding_count: i % 3,
    status: STATUSES[i % 4],
    error: i % 4 === 0 ? null : `seeded ${STATUSES[i % 4]}`,
    duration_ms: 10 + i,
  }));
  const { error: insErr } = await admin.from("security_sync_attempts" as never).insert(rows as never);
  if (insErr) throw new Error(insErr.message);
  ok(`seeded ${rows.length} sync attempts across 4 days`);

  // ---- Server-equivalent metrics read (same query as getSecuritySyncMetrics)
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const { data: metricRows, error: mErr } = await admin
    .from("security_sync_metrics_daily" as never)
    .select("day, status, count, bytes, avg_duration_ms, last_seen")
    .gte("day", since)
    .order("day", { ascending: false });
  if (mErr) throw new Error(mErr.message);
  const metrics = (metricRows ?? []) as unknown as SecuritySyncDailyMetric[];

  // ---- Panel rollup must equal an independent recount ---------------
  const panel = rollupByDay(metrics, 14);
  const expect = new Map<string, { accepted: number; other: number }>();
  for (const m of metrics) {
    const k = m.day.slice(0, 10);
    const r = expect.get(k) ?? { accepted: 0, other: 0 };
    if (m.status === "accepted") r.accepted += m.count; else r.other += m.count;
    expect.set(k, r);
  }
  const expected = [...expect.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);
  const panelMatches = panel.length === expected.length && panel.every((p, i) => {
    const e = expected[i]!;
    return p.day === e[0] && p.accepted === e[1].accepted && p.other === e[1].other && p.total === e[1].accepted + e[1].other;
  });
  if (panelMatches) ok(`panel rollup matches server metrics for ${panel.length} day(s)`);
  else bad("panel rollup matches server metrics", JSON.stringify({ panel, expected }));

  // ---- Rollup totals equal the sum of raw metric counts -------------
  const totals = rollupTotals(panel);
  const rawTotal = metrics
    .filter((m) => panel.some((p) => p.day === m.day.slice(0, 10)))
    .reduce((s, m) => s + m.count, 0);
  if (totals.total === rawTotal) ok(`rollup totals equal raw metric counts (${rawTotal})`);
  else bad("rollup totals equal raw metric counts", `rollup=${totals.total} raw=${rawTotal}`);

  // ---- Window cap: never more than N days --------------------------
  if (rollupByDay(metrics, 2).length <= 2) ok("rollup respects the day-window cap");
  else bad("rollup respects the day-window cap");

  // ---- Empty input -------------------------------------------------
  const empty = rollupByDay([], 14);
  if (empty.length === 0 && rollupTotals(empty).total === 0) ok("empty metrics roll up to an empty panel");
  else bad("empty metrics roll up to an empty panel");

  // ---- Top-offender ranking ----------------------------------------
  const { data: ipRows } = await admin
    .from("security_sync_attempts" as never)
    .select("source_ip, status")
    .gte("received_at", since)
    .neq("status", "accepted")
    .limit(5000);
  const counts: Record<string, number> = {};
  for (const r of (ipRows ?? []) as { source_ip: string | null }[]) {
    const ip = r.source_ip ?? "unknown";
    counts[ip] = (counts[ip] ?? 0) + 1;
  }
  const ranked = rankIps(counts, 10);
  const monotonic = ranked.every((r, i) => i === 0 || ranked[i - 1]!.count >= r.count);
  if (ranked.length > 0 && monotonic && ranked.length <= 10) ok(`top-offender ranking sorted desc, capped at 10 (${ranked.length})`);
  else bad("top-offender ranking", JSON.stringify(ranked));
  if (!ranked.some((r) => r.source_ip === "" )) ok("ranking has no blank IP keys");
  else bad("ranking has no blank IP keys");

  // ---- Attempts table: filter + pagination == export ---------------
  const { data: attemptRows, error: aErr } = await admin
    .from("security_sync_attempts" as never)
    .select("*")
    .gte("received_at", testStart === "" ? since : since)
    .like("nonce", `${TAG}-%`)
    .order("received_at", { ascending: false });
  if (aErr) throw new Error(aErr.message);
  const attempts = (attemptRows ?? []) as unknown as SecuritySyncAttempt[];

  const filters = { ...emptyFilters, status: "replay", q: "203.0.113.2" };
  const filtered = applyHistoryFilter(attempts, filters, {
    date: (a) => a.received_at,
    status: (a) => a.status,
    searchable: (a) => `${a.status} ${a.nonce ?? ""} ${a.source_ip ?? ""} ${a.error ?? ""}`,
  });

  const cols = [
    { key: "received_at", label: "Received", value: (a: SecuritySyncAttempt) => a.received_at },
    { key: "status", label: "Status", value: (a: SecuritySyncAttempt) => a.status },
    { key: "source_ip", label: "Source IP", value: (a: SecuritySyncAttempt) => a.source_ip ?? "" },
    { key: "nonce", label: "Nonce", value: (a: SecuritySyncAttempt) => a.nonce ?? "" },
  ];

  const pageSize = 5;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged: SecuritySyncAttempt[] = [];
  for (let p = 1; p <= pageCount; p++) paged.push(...paginate(filtered, p, pageSize).slice);

  if (toCsv(paged, cols) === toCsv(filtered, cols)) ok(`attempts CSV parity across ${pageCount} page(s) — ${filtered.length} row(s)`);
  else bad("attempts CSV parity");
  if (JSON.stringify(paged) === JSON.stringify(filtered)) ok("attempts JSON parity");
  else bad("attempts JSON parity");

  // Last page is a partial slice and never overruns.
  const last = paginate(filtered, pageCount, pageSize);
  if (last.slice.length > 0 && last.slice.length <= pageSize && last.total === filtered.length) ok(`last page well-formed (${last.slice.length}/${pageSize})`);
  else bad("last page well-formed", JSON.stringify({ len: last.slice.length, total: last.total }));

  // Out-of-range page yields no rows rather than throwing.
  const over = paginate(filtered, pageCount + 5, pageSize);
  if (JSON.stringify(over.slice) === JSON.stringify(last.slice)) ok("page beyond the last clamps to the final page");
  else bad("page beyond the last clamps to the final page", `len=${over.slice.length}`);

  // Filter that matches nothing → empty export, single empty page.
  const none = applyHistoryFilter(attempts, { ...emptyFilters, q: "no-such-token-zzz" }, {
    date: (a) => a.received_at,
    status: (a) => a.status,
    searchable: (a) => `${a.status} ${a.nonce ?? ""}`,
  });
  const noneCsv = toCsv(none, cols);
  if (none.length === 0 && paginate(none, 1, pageSize).slice.length === 0 && noneCsv === toCsv([], cols)) ok("no-match filter yields header-only export and empty page");
  else bad("no-match filter yields header-only export", `rows=${none.length}`);
} catch (e) {
  bad("metrics parity", e instanceof Error ? e.message : String(e));
} finally {
  try { await admin.from("security_sync_attempts" as never).delete().like("nonce", `${TAG}-%`); } catch { /* best effort */ }
}

console.log(`\n${passed} passed · ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
