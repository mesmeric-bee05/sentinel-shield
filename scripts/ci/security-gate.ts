// CI gate: fail the build if any of these internal_ids are currently open
// in `security_findings`. Extend the list as more findings are resolved.
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Exits 0 with a
// warning line if service role isn't wired (e.g. forks without secrets).
import { createClient } from "@supabase/supabase-js";

const PINNED = [
  "seo_settings_unauthed",
  "provider_availability_public_read",
  "travel_time_cache_broad_authenticated_read",
] as const;

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.warn("⚠  security-gate: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — skipping gate.");
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
  process.exit(2);
}

if (!data || data.length === 0) {
  console.log(`✅ security-gate: none of ${PINNED.length} pinned findings are open.`);
  process.exit(0);
}

console.error(`❌ security-gate: ${data.length} pinned finding(s) are open:\n`);
for (const row of data) {
  console.error(`  - ${row.scanner_name}:${row.internal_id} [${row.severity}] status=${row.status} — ${row.title}`);
}
process.exit(1);
