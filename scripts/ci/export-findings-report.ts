// Emit a markdown security findings report (resolved vs remaining) from the
// `security_findings` table, plus the audit trail of applied fixes.
//
// Writes to $SECURITY_REPORT_PATH (default docs/security/findings-report.md)
// and prints the same content to stdout. Exits 0 even without credentials so
// unconfigured runs / forks stay green.
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUT = process.env.SECURITY_REPORT_PATH ?? "docs/security/findings-report.md";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.warn("⚠  export-findings-report: service-role credentials missing — skipping.");
  process.exit(0);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Finding = {
  internal_id: string;
  scanner_name: string;
  title: string;
  severity: string;
  status: string;
  resource: string | null;
  rationale: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

const { data, error } = await admin
  .from("security_findings")
  .select("internal_id, scanner_name, title, severity, status, resource, rationale, first_seen_at, last_seen_at")
  .order("severity", { ascending: true })
  .order("last_seen_at", { ascending: false });

if (error) {
  console.error(`export-findings-report: query failed — ${error.message}`);
  process.exit(2);
}

const rows = (data ?? []) as Finding[];
const esc = (s: string | null) => (s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const table = (list: Finding[]) =>
  list.length === 0
    ? "_None._\n"
    : `| Internal ID | Severity | Scanner | Resource | Title | Last seen |\n|---|---|---|---|---|---|\n${list
        .map((r) => `| \`${r.internal_id}\` | ${r.severity} | ${r.scanner_name} | ${esc(r.resource)} | ${esc(r.title)} | ${r.last_seen_at} |`)
        .join("\n")}\n`;

const resolved = rows.filter((r) => r.status === "fixed");
const documented = rows.filter((r) => r.status === "ignored");
const remaining = rows.filter((r) => r.status !== "fixed" && r.status !== "ignored");

const { data: auditRows } = await admin
  .from("security_finding_audit")
  .select("created_at, internal_id, scanner_name, resolution, affected_endpoints, affected_queries, notes")
  .order("created_at", { ascending: false })
  .limit(100);

const auditTable =
  !auditRows || auditRows.length === 0
    ? "_No remediation records yet._\n"
    : `| Recorded | Internal ID | Resolution | Endpoints | Notes |\n|---|---|---|---|---|\n${auditRows
        .map((a) => `| ${a.created_at} | \`${a.internal_id}\` | ${a.resolution} | ${esc((a.affected_endpoints ?? []).join(", "))} | ${esc(a.notes)} |`)
        .join("\n")}\n`;

const md = `# Security findings report

_Generated ${new Date().toISOString()} from \`public.security_findings\`._

| Bucket | Count |
|---|---|
| Resolved (fixed) | ${resolved.length} |
| Intentionally documented (ignored) | ${documented.length} |
| Remaining (open) | ${remaining.length} |
| Total tracked | ${rows.length} |

## Remaining (open)

${table(remaining)}
## Resolved

${table(resolved)}
## Intentionally documented

${table(documented)}
## Remediation audit trail (last 100)

${auditTable}`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, md);
console.log(md);
console.log(`\nexport-findings-report: wrote ${OUT} (resolved=${resolved.length}, documented=${documented.length}, remaining=${remaining.length})`);
process.exit(0);
