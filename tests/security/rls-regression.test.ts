// RLS regression suite for security_findings and chw_requeue_log.
// Runs against the live Supabase project using service role to provision
// ephemeral users, then asserts what anon / user / admin / service_role can
// each see and mutate. Cleans up all provisioned rows in a finally block.
//
// Run with: bun run test:rls-regression
// Skips gracefully when SUPABASE_SERVICE_ROLE_KEY is not set.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.log("⏭  Skipping RLS regression suite: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_PUBLISHABLE_KEY not set.");
  process.exit(0);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
function ok(label: string) { passed++; console.log(`  ✅ ${label}`); }
function bad(label: string, detail?: string) { failed++; console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`); }

type Provisioned = { userId: string; email: string; password: string };
const provisioned: Provisioned[] = [];
const insertedFindingIds: string[] = [];
const insertedRequeueIds: string[] = [];
const insertedAssignmentIds: string[] = [];

async function provisionUser(role: "patient" | "admin"): Promise<Provisioned> {
  const email = `rls-test-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@apexcare.test`;
  const password = `Test-${Math.random().toString(36).slice(2, 12)}-Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`create ${role}: ${error?.message}`);
  const user = data.user;
  provisioned.push({ userId: user.id, email, password });
  if (role === "admin") {
    const { error: rErr } = await admin.from("user_roles").insert({ user_id: user.id, role: "admin" });
    if (rErr && !/duplicate|unique/i.test(rErr.message)) throw new Error(`grant admin: ${rErr.message}`);
  }
  return { userId: user.id, email, password };
}

async function signedInClient(email: string, password: string) {
  const client = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign in ${email}: ${error?.message}`);
  return client;
}

async function run<T>(label: string, fn: () => Promise<T>) {
  try { await fn(); } catch (e) { bad(label, e instanceof Error ? e.message : String(e)); }
}

try {
  const patient = await provisionUser("patient");
  const adminUser = await provisionUser("admin");
  const patientClient = await signedInClient(patient.email, patient.password);
  const adminClient = await signedInClient(adminUser.email, adminUser.password);

  // Seed one synthetic finding via service role for read tests.
  const scanner = `rls-regression-${Date.now()}`;
  const internalId = `rls-${Math.random().toString(36).slice(2, 10)}`;
  const { data: seededFinding, error: seedErr } = await admin
    .from("security_findings")
    .insert({
      scanner_name: scanner,
      internal_id: internalId,
      title: "RLS regression synthetic finding",
      severity: "info",
      status: "open",
    })
    .select("id")
    .single();
  if (seedErr || !seededFinding) throw new Error(`seed finding: ${seedErr?.message}`);
  insertedFindingIds.push(seededFinding.id);

  // Seed an assignment + requeue log for read tests.
  const { data: seededAssignment, error: aErr } = await admin
    .from("chw_assignments")
    .insert({
      patient_id: patient.userId,
      task_type: "wellness_call",
      priority: "normal",
      status: "cancelled",
      created_by: adminUser.userId,
    })
    .select("id")
    .single();
  if (aErr || !seededAssignment) throw new Error(`seed assignment: ${aErr?.message}`);
  insertedAssignmentIds.push(seededAssignment.id);

  const { data: seededLog, error: lErr } = await admin
    .from("chw_requeue_log")
    .insert({
      assignment_id: seededAssignment.id,
      previous_status: "cancelled",
      retry_count: 1,
      actor_id: adminUser.userId,
      scope: "single",
    })
    .select("id")
    .single();
  if (lErr || !seededLog) throw new Error(`seed requeue log: ${lErr?.message}`);
  insertedRequeueIds.push(seededLog.id);

  // ---------- security_findings ----------
  await run("anon cannot SELECT security_findings", async () => {
    const { data } = await anon.from("security_findings").select("id").limit(5);
    if (data && data.length > 0) bad("anon cannot SELECT security_findings", "rows returned"); else ok("anon cannot SELECT security_findings");
  });
  await run("anon cannot INSERT security_findings", async () => {
    const { error } = await anon.from("security_findings").insert({ scanner_name: "x", internal_id: "y", title: "z", severity: "info" });
    if (!error) bad("anon cannot INSERT security_findings", "insert succeeded"); else ok("anon cannot INSERT security_findings");
  });
  await run("patient cannot SELECT security_findings", async () => {
    const { data } = await patientClient.from("security_findings").select("id").limit(5);
    if (data && data.length > 0) bad("patient cannot SELECT security_findings", "rows returned"); else ok("patient cannot SELECT security_findings");
  });
  await run("patient cannot INSERT security_findings", async () => {
    const { error } = await patientClient.from("security_findings").insert({ scanner_name: "x", internal_id: "y2", title: "z", severity: "info" });
    if (!error) bad("patient cannot INSERT security_findings", "insert succeeded"); else ok("patient cannot INSERT security_findings");
  });
  await run("admin can SELECT security_findings", async () => {
    const { data, error } = await adminClient.from("security_findings").select("id").eq("scanner_name", scanner);
    if (error) bad("admin can SELECT security_findings", error.message);
    else if (!data || data.length === 0) bad("admin can SELECT security_findings", "no rows returned");
    else ok("admin can SELECT security_findings");
  });
  await run("admin cannot direct INSERT security_findings (no policy)", async () => {
    const { error } = await adminClient.from("security_findings").insert({ scanner_name: scanner, internal_id: "direct-admin-insert", title: "should fail", severity: "info" });
    if (!error) bad("admin cannot direct INSERT security_findings (no policy)", "insert succeeded — should route via service role"); else ok("admin cannot direct INSERT security_findings (no policy)");
  });
  await run("service_role can SELECT + INSERT security_findings", async () => {
    const { error } = await admin.from("security_findings").select("id").limit(1);
    if (error) { bad("service_role can SELECT + INSERT security_findings", error.message); return; }
    const { data, error: iErr } = await admin.from("security_findings").insert({ scanner_name: scanner, internal_id: `svc-${Date.now()}`, title: "svc insert", severity: "info" }).select("id").single();
    if (iErr || !data) { bad("service_role can SELECT + INSERT security_findings", iErr?.message); return; }
    insertedFindingIds.push(data.id);
    ok("service_role can SELECT + INSERT security_findings");
  });

  // ---------- chw_requeue_log ----------
  await run("anon cannot SELECT chw_requeue_log", async () => {
    const { data } = await anon.from("chw_requeue_log").select("id").limit(5);
    if (data && data.length > 0) bad("anon cannot SELECT chw_requeue_log", "rows returned"); else ok("anon cannot SELECT chw_requeue_log");
  });
  await run("anon cannot INSERT chw_requeue_log", async () => {
    const { error } = await anon.from("chw_requeue_log").insert({ assignment_id: seededAssignment.id, previous_status: "cancelled", retry_count: 99, scope: "single" });
    if (!error) bad("anon cannot INSERT chw_requeue_log", "insert succeeded"); else ok("anon cannot INSERT chw_requeue_log");
  });
  await run("patient cannot SELECT chw_requeue_log", async () => {
    const { data } = await patientClient.from("chw_requeue_log").select("id").limit(5);
    if (data && data.length > 0) bad("patient cannot SELECT chw_requeue_log", "rows returned"); else ok("patient cannot SELECT chw_requeue_log");
  });
  await run("patient cannot INSERT chw_requeue_log", async () => {
    const { error } = await patientClient.from("chw_requeue_log").insert({ assignment_id: seededAssignment.id, previous_status: "cancelled", retry_count: 99, scope: "single" });
    if (!error) bad("patient cannot INSERT chw_requeue_log", "insert succeeded"); else ok("patient cannot INSERT chw_requeue_log");
  });
  await run("admin can SELECT chw_requeue_log", async () => {
    const { data, error } = await adminClient.from("chw_requeue_log").select("id").eq("id", seededLog.id);
    if (error) bad("admin can SELECT chw_requeue_log", error.message);
    else if (!data || data.length === 0) bad("admin can SELECT chw_requeue_log", "no rows returned");
    else ok("admin can SELECT chw_requeue_log");
  });
  await run("service_role can SELECT + INSERT chw_requeue_log", async () => {
    const { data, error } = await admin.from("chw_requeue_log").insert({ assignment_id: seededAssignment.id, previous_status: "cancelled", retry_count: 2, actor_id: adminUser.userId, scope: "single" }).select("id").single();
    if (error || !data) { bad("service_role can SELECT + INSERT chw_requeue_log", error?.message); return; }
    insertedRequeueIds.push(data.id);
    ok("service_role can SELECT + INSERT chw_requeue_log");
  });
} finally {
  // Cleanup: rows first, then users.
  if (insertedRequeueIds.length) await admin.from("chw_requeue_log").delete().in("id", insertedRequeueIds);
  if (insertedAssignmentIds.length) await admin.from("chw_assignments").delete().in("id", insertedAssignmentIds);
  if (insertedFindingIds.length) await admin.from("security_findings").delete().in("id", insertedFindingIds);
  for (const u of provisioned) {
    try { await admin.auth.admin.deleteUser(u.userId); } catch { /* best-effort */ }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
