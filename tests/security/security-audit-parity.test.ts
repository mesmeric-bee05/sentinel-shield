// Parity test for listSecurityFindingAudit: verifies that filtered/paged
// rows on the admin panel serialize identically to the exported CSV/JSON,
// and that the shared securityAuditExportCols contract is applied
// consistently on both surfaces.
//
// Seeds ephemeral rows through log_security_fix (as an admin), applies the
// same client-side filter+paginate helpers the UI uses, and asserts that
// the union of pages equals the full filtered export byte-for-byte.
//
// Run with: bun run test:audit-parity
import { createClient } from "@supabase/supabase-js";
import { toCsv } from "@/lib/exports";
import { applyHistoryFilter, paginate, emptyFilters } from "@/components/admin/HistoryFilters";
import { securityAuditExportCols } from "@/lib/security-audit-export";
import type { SecurityFindingAuditRow } from "@/lib/security.functions";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.log("⏭  Skipping audit-parity: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.");
  process.exit(0);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
const ok = (l: string) => { passed++; console.log(`  ✅ ${l}`); };
const bad = (l: string, d?: string) => { failed++; console.log(`  ❌ ${l}${d ? " — " + d : ""}`); };

const TAG = `audit-parity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const seededIds: string[] = [];

console.log(`\n▶ security_finding_audit export parity (${TAG})\n`);

// Seed 60 mixed rows across all three resolutions.
try {
  const inserts = Array.from({ length: 60 }).map((_, i) => ({
    internal_id: `${TAG}-${i}`,
    scanner_name: i % 2 === 0 ? "test_scanner_a" : "test_scanner_b",
    resolution: (["fixed", "ignored", "reintroduced"] as const)[i % 3],
    affected_endpoints: [`/api/test/${i}`],
    affected_queries: [`SELECT ${i}`],
    notes: `parity note ${i}`,
    resolved_by: null,
  }));
  const { data, error } = await admin.from("security_finding_audit").insert(inserts).select("id");
  if (error) throw new Error(error.message);
  seededIds.push(...(data ?? []).map((r) => r.id));
  ok(`seeded ${seededIds.length} audit rows`);
} catch (e) {
  bad("seed rows", e instanceof Error ? e.message : String(e));
  process.exit(1);
}

// Fetch back and run filter/paginate/export identical to the UI.
try {
  const { data, error } = await admin
    .from("security_finding_audit")
    .select("id, created_at, internal_id, scanner_name, resolution, resolved_by, affected_endpoints, affected_queries, notes")
    .in("id", seededIds)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SecurityFindingAuditRow[];

  const filters = { ...emptyFilters, status: "fixed", q: "test_scanner_a" };
  const filtered = applyHistoryFilter(rows, filters, {
    date: (r) => r.created_at,
    status: (r) => r.resolution,
    searchable: (r) => `${r.internal_id} ${r.scanner_name} ${r.notes ?? ""} ${(r.affected_endpoints ?? []).join(" ")} ${(r.affected_queries ?? []).join(" ")}`,
  });

  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged: SecurityFindingAuditRow[] = [];
  for (let p = 1; p <= pageCount; p++) {
    const { slice } = paginate(filtered, p, pageSize);
    paged.push(...slice);
  }

  const pagedCsv = toCsv(paged, securityAuditExportCols);
  const exportCsv = toCsv(filtered, securityAuditExportCols);
  if (pagedCsv === exportCsv) ok(`CSV parity across ${pageCount} page(s) — ${filtered.length} row(s)`);
  else bad("CSV parity", `paged bytes=${pagedCsv.length} export bytes=${exportCsv.length}`);

  const pagedJson = JSON.stringify(paged, null, 2);
  const exportJson = JSON.stringify(filtered, null, 2);
  if (pagedJson === exportJson) ok("JSON parity");
  else bad("JSON parity");

  // Sanity: filter actually narrows the seeded set.
  if (filtered.length > 0 && filtered.length < rows.length) ok(`filter applied — ${filtered.length}/${rows.length} rows`);
  else bad("filter narrowing", `filtered=${filtered.length} total=${rows.length}`);

  // ---------- Edge case: empty result set ----------
  const emptyFiltered = applyHistoryFilter(rows, { ...emptyFilters, q: "no-such-token-zzz-∅" }, {
    date: (r) => r.created_at,
    status: (r) => r.resolution,
    searchable: (r) => `${r.internal_id} ${r.scanner_name}`,
  });
  const emptyPage = paginate(emptyFiltered, 1, pageSize);
  const emptyCsv = toCsv(emptyFiltered, securityAuditExportCols);
  if (emptyFiltered.length === 0) ok("empty filter result — no rows");
  else bad("empty filter result", `got ${emptyFiltered.length}`);
  if (emptyPage.slice.length === 0 && emptyPage.total === 0) ok("empty result paginates to an empty page (total=0)");
  else bad("empty result pagination", JSON.stringify({ len: emptyPage.slice.length, total: emptyPage.total }));
  if (emptyCsv === toCsv([] as SecurityFindingAuditRow[], securityAuditExportCols)) ok("empty CSV export is header-only and stable");
  else bad("empty CSV export", `bytes=${emptyCsv.length}`);
  if (JSON.stringify(emptyFiltered, null, 2) === JSON.stringify([], null, 2)) ok("empty JSON export is []");
  else bad("empty JSON export");

  // ---------- Edge case: last page (partial slice) ----------
  const lastPage = paginate(filtered, pageCount, pageSize);
  const expectedLastLen = filtered.length === 0 ? 0 : filtered.length - (pageCount - 1) * pageSize;
  if (lastPage.slice.length === expectedLastLen) ok(`last page holds the remainder (${lastPage.slice.length} row(s))`);
  else bad("last page remainder", `got=${lastPage.slice.length} expected=${expectedLastLen}`);
  if (lastPage.total === filtered.length && lastPage.pages === pageCount) ok("last page reports correct total/pages");
  else bad("last page totals", JSON.stringify({ total: lastPage.total, pages: lastPage.pages }));
  if (filtered.length > 0 && lastPage.slice.at(-1) === filtered.at(-1)) ok("last page ends on the final filtered row");
  else bad("last page final row");
  const lastCsv = toCsv(lastPage.slice, securityAuditExportCols);
  const tailCsv = toCsv(filtered.slice((pageCount - 1) * pageSize), securityAuditExportCols);
  if (lastCsv === tailCsv) ok("last-page CSV equals the exported tail byte-for-byte");
  else bad("last-page CSV parity");

  // ---------- Edge case: page past the end ----------
  const overrun = paginate(filtered, pageCount + 3, pageSize);
  if (JSON.stringify(overrun.slice) === JSON.stringify(lastPage.slice) && overrun.total === filtered.length) ok("page beyond the last clamps to the final page");
  else bad("overrun page clamping", `len=${overrun.slice.length}`);
} catch (e) {
  bad("parity computation", e instanceof Error ? e.message : String(e));
}

// Cleanup
if (seededIds.length > 0) {
  const { error } = await admin.from("security_finding_audit").delete().in("id", seededIds);
  if (error) console.warn(`  ⚠  cleanup failed: ${error.message}`);
  else console.log(`  🧹 cleaned up ${seededIds.length} rows`);
}

console.log(`\n${passed} passed · ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
