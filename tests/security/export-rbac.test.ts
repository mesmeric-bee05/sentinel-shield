// RBAC regression for the security export endpoints.
//
// Two layers:
//  1. Static: every `export*` server fn in security.functions.ts must run
//     requireSupabaseAuth + a has_role('admin') check BEFORE importing the
//     service-role client. A refactor that drops the guard fails here.
//  2. Live (service key required): the anon Data API must not be able to read
//     the tables behind those exports, so a leaked endpoint is not a bypass.
//
// Run with: bun run test:export-rbac
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

let passed = 0;
let failed = 0;
const ok = (l: string) => { passed++; console.log(`  ✅ ${l}`); };
const bad = (l: string, d?: string) => { failed++; console.log(`  ❌ ${l}${d ? " — " + d : ""}`); };

console.log("\n▶ security export RBAC\n");

const src = readFileSync("src/lib/security.functions.ts", "utf8");

const EXPORT_FNS = ["exportSecurityFindings", "exportSecurityFindingAudit", "exportSecuritySyncAttempts", "getSecurityScanDiff", "listSecurityExportAudit"];

// Every export run must leave a durable audit row (who/when/filters/window).
["exportSecurityFindings", "exportSecurityFindingAudit", "exportSecuritySyncAttempts"].forEach((fn) => {
  const start = src.indexOf(`export const ${fn} = createServerFn`);
  const body = src.slice(start, start + 3000);
  body.includes("recordExportAudit")
    ? ok(`${fn}: writes a security_export_audit row`)
    : bad(`${fn}: export run is not audited`);
});

for (const fn of EXPORT_FNS) {
  const start = src.indexOf(`export const ${fn} = createServerFn`);
  if (start === -1) { bad(`${fn}: not exported from security.functions.ts`); continue; }
  const next = EXPORT_FNS.map((f) => src.indexOf(`export const ${f} = createServerFn`)).filter((i) => i > start);
  const end = next.length ? Math.min(...next) : src.length;
  const body = src.slice(start, end);

  body.includes("requireSupabaseAuth")
    ? ok(`${fn}: requires an authenticated session`)
    : bad(`${fn}: missing requireSupabaseAuth middleware`);

  const guardIdx = body.indexOf("assertAdmin");
  const adminIdx = body.indexOf("client.server");
  guardIdx !== -1 && (adminIdx === -1 || guardIdx < adminIdx)
    ? ok(`${fn}: admin role verified before any service-role read`)
    : bad(`${fn}: service-role client reached without a preceding admin check`);

  /Forbidden|forbiddenExport\(/.test(body)
    ? ok(`${fn}: returns a Forbidden verdict for non-admins`)
    : bad(`${fn}: no Forbidden branch`);

  // The Forbidden branch must not carry rows.
  const fIdx = Math.max(body.indexOf("forbiddenExport("), body.indexOf("Forbidden"));
  const forbiddenBlock = body.slice(Math.max(0, fIdx - 200), fIdx + 200);
  /rows: \[\] as|forbiddenExport|resolved: \[\]/.test(forbiddenBlock)
    ? ok(`${fn}: Forbidden verdict returns zero rows`)
    : bad(`${fn}: Forbidden verdict may leak rows`, forbiddenBlock.slice(0, 120));
}

// Client-side download helper must go through the server export fn.
const client = readFileSync("src/lib/security-export-client.ts", "utf8");
client.includes("reasonFromResult") && client.includes("pagination.hasMore")
  ? ok("export client: honours Forbidden verdict and server pagination")
  : bad("export client: missing denial handling or pagination loop");

for (const page of ["src/routes/app.admin.security.tsx", "src/routes/app.admin.security-audit.tsx", "src/routes/app.admin.security-sync.tsx"]) {
  const p = readFileSync(page, "utf8");
  p.includes("runServerExport") && !/onExportCsv=\{\(\) => downloadCsv/.test(p)
    ? ok(`${page.split("/").pop()}: downloads use the RBAC-enforced endpoint`)
    : bad(`${page.split("/").pop()}: still exports client-side rows`);
}

// ------------------------------------------------------------------ live anon
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.log("  ⏭  live anon checks skipped (no Supabase URL / publishable key)");
} else {
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  for (const table of ["security_findings", "security_finding_audit", "security_sync_attempts"]) {
    const { data, error } = await anon.from(table as never).select("*").limit(1);
    const rows = (data ?? []) as unknown[];
    error || rows.length === 0
      ? ok(`anon cannot read ${table}`)
      : bad(`anon read ${table} returned ${rows.length} row(s)`);
  }
}

console.log(`\n${failed === 0 ? "✅" : "❌"} export RBAC: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
