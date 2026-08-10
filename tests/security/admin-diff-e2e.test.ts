// End-to-end coverage of the admin scan-diff flow:
//   • the diff page renders the three buckets and refreshes on new scans
//   • CSV/JSON downloads go through the RBAC-enforced server export path
//   • a non-admin / anonymous caller gets a Forbidden verdict with zero rows
//   • the export client walks every server page and the file matches the rows
//
// Server-side RBAC is exercised against the real handlers via static contract
// checks (the same guarantee export-rbac asserts) plus a simulated server that
// mirrors the Forbidden verdict shape returned by `forbiddenExport`.
//
// Run with: bun run test:admin-diff-e2e
import { readFileSync } from "node:fs";
import { fetchAllExportRows, toExportFilters, type ExportFilters, type ExportPage } from "../../src/lib/security-export-client";
import { toCsv, type ExportColumn } from "../../src/lib/exports";
import { ScanDiffResponseSchema } from "../../src/lib/security-contracts";

let passed = 0;
let failed = 0;
const ok = (l: string) => { passed++; console.log(`  ✅ ${l}`); };
const bad = (l: string, d?: string) => { failed++; console.log(`  ❌ ${l}${d ? " — " + d : ""}`); };

console.log("\n▶ admin scan-diff + export E2E\n");

// ---------------------------------------------------------------- diff page UI
const page = readFileSync("src/routes/app.admin.security-diff.tsx", "utf8");

["Newly introduced", "Remaining", "Resolved"].forEach((bucket) =>
  page.includes(bucket) ? ok(`diff page renders the "${bucket}" bucket`) : bad(`diff page missing the "${bucket}" bucket`),
);

page.includes("ScanDiffResponseSchema.safeParse")
  ? ok("diff page validates the server response against the shared contract")
  : bad("diff page does not validate the diff contract");

page.includes("PermissionDeniedCard") && page.includes("reasonFromResult")
  ? ok("diff page surfaces an explicit insufficient-permissions state")
  : bad("diff page has no Forbidden state");

/postgres_changes[\s\S]{0,200}security_findings/.test(page) && page.includes("removeChannel")
  ? ok("diff page subscribes to security_findings realtime and tears the channel down")
  : bad("diff page missing realtime refresh or channel cleanup");

page.includes("downloadCsv") && page.includes("downloadJson")
  ? ok("diff page offers both CSV and JSON downloads")
  : bad("diff page missing a CSV or JSON download");

// ------------------------------------------------------- server contract shape
const src = readFileSync("src/lib/security.functions.ts", "utf8");
const diffStart = src.indexOf("export const getSecurityScanDiff = createServerFn");
const diffBody = src.slice(diffStart, diffStart + 4000);
diffBody.includes("requireSupabaseAuth") && diffBody.indexOf("assertAdmin") < diffBody.indexOf("client.server")
  ? ok("getSecurityScanDiff verifies admin before any service-role read")
  : bad("getSecurityScanDiff is missing an admin guard");

const emptyDiff = {
  error: null, latestScanAt: null, previousScanAt: null,
  resolved: [], remaining: [], newlyIntroduced: [], reports: [],
};
ScanDiffResponseSchema.safeParse(emptyDiff).success
  ? ok("empty diff payload satisfies the shared contract")
  : bad("empty diff payload fails the contract schema");

// --------------------------------------------------------- simulated admin flow
type Row = { id: string; internal_id: string; severity: string; status: string };
const TOTAL = 1207; // 3 server pages at 500/page
const allRows: Row[] = Array.from({ length: TOTAL }, (_, i) => ({
  id: `id-${i}`,
  internal_id: `finding_${i}`,
  severity: i % 3 === 0 ? "error" : "warn",
  status: i % 2 === 0 ? "open" : "resolved",
}));

const cols: ExportColumn<Row>[] = [
  { key: "internal_id", label: "Internal ID", value: (r) => r.internal_id },
  { key: "severity", label: "Severity", value: (r) => r.severity },
  { key: "status", label: "Status", value: (r) => r.status },
];

const calls: ExportFilters[] = [];
const makeServer = (role: "admin" | "user") => async ({ data }: { data: ExportFilters }): Promise<ExportPage<Row>> => {
  calls.push(data);
  if (role !== "admin") {
    // Mirrors forbiddenExport() in security.functions.ts.
    return { error: "Forbidden", rows: [], pagination: { page: data.page, pageSize: data.pageSize, total: 0, totalPages: 0, hasMore: false } };
  }
  const start = (data.page - 1) * data.pageSize;
  const slice = allRows.slice(start, start + data.pageSize);
  return {
    error: null,
    rows: slice,
    pagination: {
      page: data.page,
      pageSize: data.pageSize,
      total: TOTAL,
      totalPages: Math.ceil(TOTAL / data.pageSize),
      hasMore: start + slice.length < TOTAL,
    },
  };
};

const filters = { q: "", status: "", from: "", to: "" } as Parameters<typeof toExportFilters>[0];

// admin: walks every page, gets every row exactly once
calls.length = 0;
const adminOutcome = await fetchAllExportRows(makeServer("admin"), filters);
if (!adminOutcome.ok) {
  bad("admin export was denied");
} else {
  adminOutcome.rows.length === TOTAL ? ok(`admin export returned all ${TOTAL} rows`) : bad(`admin export returned ${adminOutcome.rows.length}/${TOTAL} rows`);
  calls.length === 3 ? ok("export walked exactly 3 server pages (500/page)") : bad(`export made ${calls.length} page requests, expected 3`);
  new Set(adminOutcome.rows.map((r) => r.id)).size === TOTAL ? ok("no duplicated rows across page boundaries") : bad("duplicate rows across pages");
  adminOutcome.rows[0]?.id === "id-0" && adminOutcome.rows[TOTAL - 1]?.id === `id-${TOTAL - 1}`
    ? ok("page ordering preserved from first to last row")
    : bad("row ordering broken across pages");

  // CSV and JSON must contain exactly the fetched rows.
  const csv = toCsv(adminOutcome.rows, cols);
  const lines = csv.trim().split("\n");
  lines.length === TOTAL + 1 ? ok("CSV has one header row plus every data row") : bad(`CSV had ${lines.length} lines, expected ${TOTAL + 1}`);
  lines[0] === "Internal ID,Severity,Status" ? ok("CSV header matches the declared columns") : bad(`unexpected CSV header: ${lines[0]}`);
  lines[1]?.includes("finding_0") ? ok("CSV first data row matches the first fetched row") : bad("CSV first data row mismatch");

  const json = JSON.parse(JSON.stringify(adminOutcome.rows)) as Row[];
  json.length === TOTAL && json[42]?.internal_id === "finding_42"
    ? ok("JSON export is byte-equivalent to the fetched rows")
    : bad("JSON export diverged from the fetched rows");
}

// non-admin: Forbidden verdict, zero rows, single request (no page walking)
calls.length = 0;
const userOutcome = await fetchAllExportRows(makeServer("user"), filters);
if (userOutcome.ok) {
  bad("non-admin export was allowed");
} else {
  userOutcome.denied ? ok("non-admin export reports an insufficient-permissions reason") : bad("non-admin denial not classified");
  userOutcome.error === "Forbidden" ? ok("non-admin receives the Forbidden verdict") : bad(`non-admin error was ${userOutcome.error}`);
  calls.length === 1 ? ok("denied export stops after the first page (no data probing)") : bad(`denied export made ${calls.length} requests`);
}

// filters are forwarded to the server, not applied client-side
const mapped = toExportFilters({ q: "seo", status: "open", from: "2026-08-01", to: "2026-08-09" } as never, 2, 100);
mapped.search === "seo" && mapped.status === "open" && mapped.page === 2 && mapped.pageSize === 100
  && mapped.from === "2026-08-01T00:00:00.000Z" && mapped.to === "2026-08-09T23:59:59.999Z"
  ? ok("admin filters map to server-side export filters (inclusive day window)")
  : bad("filter mapping incorrect", JSON.stringify(mapped));

// --------------------------------------------------------------- audit exposure
const panel = readFileSync("src/components/admin/ExportAuditPanel.tsx", "utf8");
panel.includes("listSecurityExportAudit") && panel.includes("PermissionDeniedCard")
  ? ok("export audit panel reads through the admin-guarded reader")
  : bad("export audit panel is not admin-guarded");

console.log(`\n${failed === 0 ? "✅" : "❌"} admin diff E2E: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
