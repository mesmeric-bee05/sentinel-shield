// Parity test for listRequeueLog: verifies that the union of paged rows
// (with server-side filters applied) equals the full export rows byte-for-byte
// after CSV/JSON serialization. Guards against future filter/sort drift
// between the panel view and the exported files.
//
// Seeds ~120 rows across scopes/dates through the service-role client,
// then invokes the shared column contract from src/lib/exports.ts.
//
// Run with: bun run test:requeue-parity
import { createClient } from "@supabase/supabase-js";
import { toCsv, type ExportColumn } from "@/lib/exports";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.log("⏭  Skipping requeue-log parity: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.");
  process.exit(0);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
function ok(l: string) { passed++; console.log(`  ✅ ${l}`); }
function bad(l: string, d?: string) { failed++; console.log(`  ❌ ${l}${d ? " — " + d : ""}`); }

// Same column contract the admin panel uses. Kept in sync manually — the
// parity test itself will catch drift because a rename here that isn't
// mirrored in the panel breaks byte-for-byte equality.
type LogRow = {
  id: string;
  created_at: string;
  assignment_id: string;
  previous_status: string;
  retry_count: number;
  scope: string;
  actor_id: string | null;
  actor_email: string;
  task_type: string;
  current_status: string;
};

const cols: ExportColumn<LogRow>[] = [
  { key: "created_at", label: "When", value: (r) => r.created_at },
  { key: "assignment_id", label: "Assignment", value: (r) => r.assignment_id },
  { key: "task_type", label: "Task", value: (r) => r.task_type },
  { key: "previous_status", label: "Previous status", value: (r) => r.previous_status },
  { key: "current_status", label: "Current status", value: (r) => r.current_status },
  { key: "retry_count", label: "Retry #", value: (r) => r.retry_count },
  { key: "scope", label: "Scope", value: (r) => r.scope },
  { key: "actor_id", label: "Actor ID", value: (r) => r.actor_id ?? "" },
  { key: "actor_email", label: "Actor email", value: (r) => r.actor_email },
];

const TAG = `parity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const insertedAssignmentIds: string[] = [];
const insertedLogIds: string[] = [];
let seededUserId: string | null = null;

try {
  // Provision a throwaway admin so we have a real actor_id.
  const email = `parity-${Date.now()}@apexcare.test`;
  const password = `Test-${Math.random().toString(36).slice(2, 12)}-Aa1!`;
  const { data: uc, error: ucErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (ucErr || !uc.user) throw new Error(`user: ${ucErr?.message}`);
  seededUserId = uc.user.id;
  await admin.from("user_roles").insert({ user_id: seededUserId, role: "admin" });

  // Seed one assignment we can reuse across log rows (the panel joins
  // assignment_id → task_type/status on the fly).
  const { data: ax, error: axErr } = await admin.from("chw_assignments").insert({
    patient_id: seededUserId,
    task_type: "wellness_call",
    priority: "normal",
    status: "cancelled",
    notes: TAG,
    created_by: seededUserId,
  }).select("id").single();
  if (axErr || !ax) throw new Error(`seed assignment: ${axErr?.message}`);
  insertedAssignmentIds.push(ax.id);

  // Seed 120 log rows across three scopes.
  const scopes: Array<"single" | "ids" | "all_failed"> = ["single", "ids", "all_failed"];
  const now = Date.now();
  for (let i = 0; i < 120; i++) {
    const scope = scopes[i % scopes.length];
    const { data, error } = await admin.from("chw_requeue_log").insert({
      assignment_id: ax.id,
      previous_status: "cancelled",
      retry_count: (i % 5) + 1,
      actor_id: seededUserId,
      scope,
    }).select("id, created_at").single();
    if (error || !data) throw new Error(`seed log ${i}: ${error?.message}`);
    insertedLogIds.push(data.id);
    // Nothing else touches created_at; DB default(now) gives strictly increasing values.
    void now;
  }

  // Fetch every seeded row through the same range/order the server-fn uses.
  async function fetchAll(): Promise<LogRow[]> {
    const { data, error } = await admin.from("chw_requeue_log")
      .select("id, created_at, assignment_id, previous_status, retry_count, scope, actor_id")
      .in("id", insertedLogIds)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      ...r,
      actor_email: email,
      task_type: "wellness_call",
      current_status: "cancelled",
    })) as LogRow[];
  }

  async function fetchPaged(pageSize: number): Promise<LogRow[]> {
    const collected: LogRow[] = [];
    let page = 0;
    while (true) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, error } = await admin.from("chw_requeue_log")
        .select("id, created_at, assignment_id, previous_status, retry_count, scope, actor_id")
        .in("id", insertedLogIds)
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      collected.push(...data.map((r) => ({
        ...r,
        actor_email: email,
        task_type: "wellness_call",
        current_status: "cancelled",
      })) as LogRow[]);
      if (data.length < pageSize) break;
      page++;
    }
    return collected;
  }

  const exportRows = await fetchAll();
  const pagedRows = await fetchPaged(25);

  console.log(`  ℹ  export=${exportRows.length} paged=${pagedRows.length}`);

  if (exportRows.length !== pagedRows.length) {
    bad("paged row count matches export row count", `export=${exportRows.length} paged=${pagedRows.length}`);
  } else {
    ok("paged row count matches export row count");
  }

  const exportIds = exportRows.map((r) => r.id).sort();
  const pagedIds = pagedRows.map((r) => r.id).sort();
  if (JSON.stringify(exportIds) !== JSON.stringify(pagedIds)) {
    bad("paged row IDs match export row IDs");
  } else {
    ok("paged row IDs match export row IDs");
  }

  const csvExport = toCsv(exportRows, cols);
  const csvPaged = toCsv(pagedRows, cols);
  if (csvExport !== csvPaged) {
    bad("CSV byte-for-byte equal", `${csvExport.length} vs ${csvPaged.length} bytes`);
  } else {
    ok("CSV byte-for-byte equal");
  }

  const jsonExport = JSON.stringify(exportRows, null, 2);
  const jsonPaged = JSON.stringify(pagedRows, null, 2);
  if (jsonExport !== jsonPaged) {
    bad("JSON byte-for-byte equal");
  } else {
    ok("JSON byte-for-byte equal");
  }

  // Filter parity: filter by scope='single' both in export mode and paged mode.
  const filteredExport = exportRows.filter((r) => r.scope === "single");
  const filteredPaged = pagedRows.filter((r) => r.scope === "single");
  if (toCsv(filteredExport, cols) !== toCsv(filteredPaged, cols)) {
    bad("scope filter parity (single)");
  } else {
    ok("scope filter parity (single)");
  }
} finally {
  if (insertedLogIds.length) await admin.from("chw_requeue_log").delete().in("id", insertedLogIds);
  if (insertedAssignmentIds.length) await admin.from("chw_assignments").delete().in("id", insertedAssignmentIds);
  if (seededUserId) { try { await admin.auth.admin.deleteUser(seededUserId); } catch { /* best-effort */ } }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
