// CI gate: fail the build if any of these internal_ids are currently open
// in `security_findings`. Emits:
//   - GitHub workflow annotations (::error ... ::) so each reintroduced finding
//     shows up inline on the PR "Checks" tab.
//   - A markdown job summary written to $GITHUB_STEP_SUMMARY.
//   - A machine-readable JSON payload at $SECURITY_GATE_OUTPUT (or
//     /tmp/security-gate.json) so downstream notifier steps can fan the
//     result out to Slack / email without re-querying the DB.
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Exits 0 with a
// warning line if service role isn't wired (e.g. forks without secrets).
import { createClient } from "@supabase/supabase-js";
import { appendFileSync, writeFileSync } from "node:fs";

const PINNED = [
  "seo_settings_unauthed",
  "provider_availability_public_read",
  "travel_time_cache_broad_authenticated_read",
] as const;

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUMMARY_PATH = process.env.GITHUB_STEP_SUMMARY;
const OUTPUT_PATH = process.env.SECURITY_GATE_OUTPUT ?? "/tmp/security-gate.json";
const RUN_URL =
  process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;
const ARTIFACT_URL = RUN_URL ? `${RUN_URL}#artifacts` : null;
const REPORT_URL = process.env.SECURITY_REPORT_URL ?? null;

type OpenFinding = {
  internal_id: string;
  scanner_name: string;
  title: string;
  severity: string;
  status: string;
  last_seen_at: string;
};

function writeSummary(md: string) {
  if (SUMMARY_PATH) {
    try { appendFileSync(SUMMARY_PATH, md + "\n"); } catch { /* best effort */ }
  }
}

function writeOutput(payload: { ok: boolean; open: OpenFinding[]; run_url: string | null; artifact_url: string | null; report_url: string | null }) {
  try { writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2)); } catch { /* best effort */ }
}

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.warn("⚠  security-gate: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — skipping gate.");
  writeSummary("## Security-scan gate\n\n⚠ Skipped — service-role credentials not available in this run.");
  writeOutput({ ok: true, open: [], run_url: RUN_URL, artifact_url: ARTIFACT_URL, report_url: REPORT_URL });
  process.exit(0);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const { data, error } = await admin
  .from("security_findings")
  .select("internal_id, scanner_name, title, severity, status, last_seen_at")
  .in("internal_id", PINNED as unknown as string[])
  .neq("status", "fixed")
  .neq("status", "ignored");

if (error) {
  console.error(`security-gate: query failed: ${error.message}`);
  writeSummary(`## Security-scan gate\n\n❌ Query failed: \`${error.message}\``);
  writeOutput({ ok: false, open: [], run_url: RUN_URL, artifact_url: ARTIFACT_URL, report_url: REPORT_URL });
  process.exit(2);
}

const openFindings = (data ?? []) as OpenFinding[];

if (openFindings.length === 0) {
  console.log(`✅ security-gate: none of ${PINNED.length} pinned findings are open.`);
  writeSummary(`## Security-scan gate\n\n✅ All ${PINNED.length} pinned findings remain resolved.\n\nPinned IDs: ${PINNED.map((id) => `\`${id}\``).join(", ")}`);
  writeOutput({ ok: true, open: [], run_url: RUN_URL, artifact_url: ARTIFACT_URL, report_url: REPORT_URL });
  process.exit(0);
}

console.error(`❌ security-gate: ${openFindings.length} pinned finding(s) are open:\n`);

// Workflow annotations — one ::error per finding so GitHub renders them
// inline on the PR "Checks" tab.
for (const row of openFindings) {
  const title = `Reintroduced security finding: ${row.internal_id}`;
  const message = `[${row.severity}] ${row.scanner_name} — ${row.title} (status=${row.status}, last_seen=${row.last_seen_at})`;
  console.log(`::error title=${title}::${message}`);
  console.error(`  - ${row.scanner_name}:${row.internal_id} [${row.severity}] status=${row.status} — ${row.title}`);
}

// Job summary — markdown table + run link.
const rows = openFindings
  .map((r) => `| \`${r.internal_id}\` | ${r.severity} | ${r.scanner_name} | ${r.status} | ${r.last_seen_at} | ${r.title.replace(/\|/g, "\\|")} |`)
  .join("\n");
writeSummary(
  `## Security-scan gate — FAILED\n\n${openFindings.length} pinned finding(s) reintroduced. See the [Security tracker](../app/admin/security) for the full context.\n\n| Internal ID | Severity | Scanner | Status | Last seen | Title |\n|---|---|---|---|---|---|\n${rows}\n`
);

writeOutput({ ok: false, open: openFindings, run_url: RUN_URL, artifact_url: ARTIFACT_URL, report_url: REPORT_URL });
process.exit(1);
