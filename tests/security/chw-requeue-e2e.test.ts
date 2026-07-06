// End-to-end: seeds 5 CHW assignments (3 failed via last_error, 2 succeeded
// via status=completed) and asserts that a bulk "requeue failed" run only
// touches the 3 failed IDs — never the 2 succeeded ones — and that a second
// invocation with the same target list is a no-op for already-in-flight rows.
//
// Runs against the live Supabase project via service role. Skips gracefully
// when the service key is missing.
//
// Run with: bun run test:chw-requeue-e2e
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.log("⏭  Skipping chw-requeue-e2e: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.");
  process.exit(0);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
function ok(l: string) { passed++; console.log(`  ✅ ${l}`); }
function bad(l: string, d?: string) { failed++; console.log(`  ❌ ${l}${d ? " — " + d : ""}`); }

let seededUserId: string | null = null;
const seededAssignmentIds: string[] = [];
const failedIds: string[] = [];
const succeededIds: string[] = [];

async function runRequeueFailed(ids: string[]): Promise<number> {
  // Server-side equivalent of the requeueFailed server-fn body — reused here
  // so we exercise the same DB effects (assignment update + audit + requeue log)
  // without needing a signed-in bearer token.
  const { data: candidates, error } = await admin
    .from("chw_assignments")
    .select("id, retry_count, status, last_error")
    .in("id", ids);
  if (error) throw new Error(error.message);
  const eligible = (candidates ?? []).filter(
    (r) => r.status === "cancelled" || r.status === "escalated" || !!r.last_error,
  );
  let requeued = 0;
  const dueAt = new Date(Date.now() + 4 * 3600 * 1000).toISOString();
  for (const row of eligible) {
    const newRetry = (row.retry_count ?? 0) + 1;
    const { error: upErr } = await admin
      .from("chw_assignments")
      .update({
        status: "pending",
        retry_count: newRetry,
        last_error: null,
        last_error_at: null,
        due_at: dueAt,
      })
      .eq("id", row.id);
    if (!upErr) {
      requeued++;
      await admin.from("chw_requeue_log").insert({
        assignment_id: row.id,
        previous_status: row.status,
        retry_count: newRetry,
        actor_id: seededUserId,
        scope: "ids",
      });
    }
  }
  return requeued;
}

try {
  const email = `e2e-${Date.now()}@apexcare.test`;
  const password = `Test-${Math.random().toString(36).slice(2, 12)}-Aa1!`;
  const { data: uc, error: ucErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (ucErr || !uc.user) throw new Error(`user: ${ucErr?.message}`);
  seededUserId = uc.user.id;

  // Seed 3 failed (cancelled + last_error) + 2 succeeded (completed).
  for (let i = 0; i < 3; i++) {
    const { data, error } = await admin.from("chw_assignments").insert({
      patient_id: seededUserId,
      task_type: "wellness_call",
      priority: "normal",
      status: "cancelled",
      last_error: `e2e failure ${i}`,
      last_error_at: new Date().toISOString(),
      created_by: seededUserId,
    }).select("id").single();
    if (error || !data) throw new Error(`seed failed ${i}: ${error?.message}`);
    failedIds.push(data.id);
    seededAssignmentIds.push(data.id);
  }
  for (let i = 0; i < 2; i++) {
    const { data, error } = await admin.from("chw_assignments").insert({
      patient_id: seededUserId,
      task_type: "wellness_call",
      priority: "normal",
      status: "completed",
      created_by: seededUserId,
    }).select("id").single();
    if (error || !data) throw new Error(`seed succeeded ${i}: ${error?.message}`);
    succeededIds.push(data.id);
    seededAssignmentIds.push(data.id);
  }

  // First run — over the union of all 5 IDs. Only the 3 failed should update.
  const targetIds = [...failedIds, ...succeededIds];
  const requeued = await runRequeueFailed(targetIds);
  if (requeued !== 3) bad("first run requeues exactly 3 failed assignments", `requeued=${requeued}`);
  else ok("first run requeues exactly 3 failed assignments");

  // Failed IDs are now status=pending with retry_count=1.
  const { data: postFailed } = await admin.from("chw_assignments")
    .select("id, status, retry_count, last_error")
    .in("id", failedIds);
  const allPending = (postFailed ?? []).every((r) => r.status === "pending" && r.retry_count === 1 && r.last_error === null);
  if (!allPending) bad("all 3 failed rows moved to pending / retry=1 / cleared error");
  else ok("all 3 failed rows moved to pending / retry=1 / cleared error");

  // Succeeded IDs must be unchanged (status=completed, retry_count=0).
  const { data: postSucc } = await admin.from("chw_assignments")
    .select("id, status, retry_count")
    .in("id", succeededIds);
  const allCompleted = (postSucc ?? []).every((r) => r.status === "completed" && (r.retry_count ?? 0) === 0);
  if (!allCompleted) bad("2 succeeded rows untouched by requeue");
  else ok("2 succeeded rows untouched by requeue");

  // Requeue log has exactly 3 rows for the failed IDs, 0 for the succeeded IDs.
  const { data: logRows } = await admin.from("chw_requeue_log")
    .select("assignment_id")
    .in("assignment_id", targetIds);
  const logForFailed = (logRows ?? []).filter((r) => failedIds.includes(r.assignment_id)).length;
  const logForSucc = (logRows ?? []).filter((r) => succeededIds.includes(r.assignment_id)).length;
  if (logForFailed !== 3) bad("requeue log has 3 rows for failed IDs", `got=${logForFailed}`);
  else ok("requeue log has 3 rows for failed IDs");
  if (logForSucc !== 0) bad("requeue log has 0 rows for succeeded IDs", `got=${logForSucc}`);
  else ok("requeue log has 0 rows for succeeded IDs");

  // Second run — after the first, all previously-failed rows are `pending`
  // with last_error=null, so they're no longer eligible. No new rows should
  // be written and nothing should update.
  const requeued2 = await runRequeueFailed(targetIds);
  if (requeued2 !== 0) bad("second run is a no-op (0 requeued)", `requeued=${requeued2}`);
  else ok("second run is a no-op (0 requeued)");

  const { data: logRows2 } = await admin.from("chw_requeue_log")
    .select("id")
    .in("assignment_id", targetIds);
  if ((logRows2?.length ?? 0) !== 3) bad("requeue log row count unchanged after no-op re-run", `got=${logRows2?.length}`);
  else ok("requeue log row count unchanged after no-op re-run");
} finally {
  if (seededAssignmentIds.length) {
    await admin.from("chw_requeue_log").delete().in("assignment_id", seededAssignmentIds);
    await admin.from("chw_assignments").delete().in("id", seededAssignmentIds);
  }
  if (seededUserId) {
    try { await admin.auth.admin.deleteUser(seededUserId); } catch { /* best-effort */ }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
