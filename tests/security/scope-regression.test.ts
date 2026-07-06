// Scope regression: verifies that (1) getSeoSettings requires auth+admin,
// (2) provider_availability public reads are filtered to active providers,
// (3) travel_time_cache is admin-only for authenticated reads.
//
// The getSeoSettings check exercises the same has_role('admin') gate the
// server-fn uses. We can't invoke the TanStack RPC surface from bun, so we
// verify the middleware+guard contract directly: anon has no session,
// non-admins fail has_role, admins pass. If any of those change, the
// server-fn's Forbidden branch changes too.
//
// Run with: bun run test:scope-regression
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.log("⏭  Skipping scope-regression: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_PUBLISHABLE_KEY not set.");
  process.exit(0);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
function ok(l: string) { passed++; console.log(`  ✅ ${l}`); }
function bad(l: string, d?: string) { failed++; console.log(`  ❌ ${l}${d ? " — " + d : ""}`); }
async function run(l: string, f: () => Promise<void>) {
  try { await f(); } catch (e) { bad(l, e instanceof Error ? e.message : String(e)); }
}

type Prov = { userId: string; email: string; password: string };
const users: Prov[] = [];
const providerIds: string[] = [];
const availabilityIds: string[] = [];
const cacheIds: string[] = [];

async function provision(role: "patient" | "admin"): Promise<Prov> {
  const email = `scope-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@apexcare.test`;
  const password = `Test-${Math.random().toString(36).slice(2, 12)}-Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`create ${role}: ${error?.message}`);
  users.push({ userId: data.user.id, email, password });
  if (role === "admin") {
    const { error: e } = await admin.from("user_roles").insert({ user_id: data.user.id, role: "admin" });
    if (e && !/duplicate|unique/i.test(e.message)) throw new Error(`grant admin: ${e.message}`);
  }
  return users[users.length - 1];
}

async function signIn(email: string, password: string) {
  const c = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign in ${email}: ${error?.message}`);
  return { client: c, token: data.session.access_token };
}

try {
  const patient = await provision("patient");
  const adminUser = await provision("admin");
  const patientSess = await signIn(patient.email, patient.password);
  const adminSess = await signIn(adminUser.email, adminUser.password);

  // ---------- getSeoSettings gate parity ----------
  // The server-fn returns { settings:null, error:'Forbidden' } whenever
  // has_role(auth.uid(),'admin') is false — this is the exact gate we assert.
  await run("getSeoSettings gate: non-admin user has no admin role → Forbidden branch", async () => {
    const { data: isAdmin } = await patientSess.client.rpc("has_role", { _user_id: patient.userId, _role: "admin" });
    if (isAdmin) return bad("getSeoSettings gate: non-admin user has no admin role → Forbidden branch", "patient unexpectedly has admin role");
    ok("getSeoSettings gate: non-admin user has no admin role → Forbidden branch");
  });

  await run("getSeoSettings gate: admin user passes has_role → settings branch", async () => {
    const { data: isAdmin } = await adminSess.client.rpc("has_role", { _user_id: adminUser.userId, _role: "admin" });
    if (!isAdmin) return bad("getSeoSettings gate: admin user passes has_role → settings branch", "admin role not present");
    ok("getSeoSettings gate: admin user passes has_role → settings branch");
  });

  await run("getSeoSettings: anon direct read of seo_settings is blocked (no policy)", async () => {
    // The server-fn uses supabaseAdmin (bypasses RLS) but is gated by auth+role.
    // The underlying table must NOT be publicly readable via anon.
    const { data } = await anon.from("seo_settings").select("gsc_meta_token");
    if (data && data.length > 0 && data.some((r) => (r as { gsc_meta_token?: string | null }).gsc_meta_token)) {
      return bad("getSeoSettings: anon direct read of seo_settings is blocked (no policy)", "anon saw gsc_meta_token");
    }
    ok("getSeoSettings: anon direct read of seo_settings is blocked (no policy)");
  });



  // ---------- provider_availability: only active providers are public ----------
  const { data: activeProv, error: apErr } = await admin.from("providers").insert({
    user_id: adminUser.userId,
    display_name: `Scope Active ${Date.now()}`,
    specialty: "general",
    is_active: true,
  }).select("id").single();
  if (apErr || !activeProv) throw new Error(`seed active provider: ${apErr?.message}`);
  providerIds.push(activeProv.id);

  const { data: inactiveProv, error: ipErr } = await admin.from("providers").insert({
    user_id: patient.userId,
    display_name: `Scope Inactive ${Date.now()}`,
    specialty: "general",
    is_active: false,
  }).select("id").single();
  if (ipErr || !inactiveProv) throw new Error(`seed inactive provider: ${ipErr?.message}`);
  providerIds.push(inactiveProv.id);

  const { data: aAvail, error: aaErr } = await admin.from("provider_availability").insert({
    provider_id: activeProv.id,
    weekday: 1, start_time: "09:00", end_time: "17:00",
  }).select("id").single();
  if (aaErr || !aAvail) throw new Error(`seed active availability: ${aaErr?.message}`);
  availabilityIds.push(aAvail.id);

  const { data: iAvail, error: iaErr } = await admin.from("provider_availability").insert({
    provider_id: inactiveProv.id,
    weekday: 1, start_time: "09:00", end_time: "17:00",
  }).select("id").single();
  if (iaErr || !iAvail) throw new Error(`seed inactive availability: ${iaErr?.message}`);
  availabilityIds.push(iAvail.id);

  await run("anon SELECT provider_availability sees active row", async () => {
    const { data, error } = await anon.from("provider_availability").select("id, provider_id").eq("id", aAvail.id);
    if (error) return bad("anon SELECT provider_availability sees active row", error.message);
    if (!data || data.length === 0) return bad("anon SELECT provider_availability sees active row", "no row returned");
    ok("anon SELECT provider_availability sees active row");
  });

  await run("anon SELECT provider_availability filters inactive row", async () => {
    const { data, error } = await anon.from("provider_availability").select("id").eq("id", iAvail.id);
    if (error) return bad("anon SELECT provider_availability filters inactive row", error.message);
    if (data && data.length > 0) return bad("anon SELECT provider_availability filters inactive row", "inactive row was visible");
    ok("anon SELECT provider_availability filters inactive row");
  });

  // ---------- travel_time_cache: admin-only for authenticated reads ----------
  const { data: cacheRow, error: cErr } = await admin.from("travel_time_cache").insert({
    origin_lat: 40.0, origin_lng: -74.0,
    dest_lat: 40.1, dest_lng: -74.1,
    mode: "driving",
    provider: "test",
    duration_seconds: 600,
    distance_meters: 5000,
  }).select("id").single();
  if (cErr || !cacheRow) throw new Error(`seed travel_time_cache: ${cErr?.message}`);
  cacheIds.push(cacheRow.id);

  await run("anon SELECT travel_time_cache returns no rows", async () => {
    const { data } = await anon.from("travel_time_cache").select("id").eq("id", cacheRow.id);
    if (data && data.length > 0) return bad("anon SELECT travel_time_cache returns no rows", "row was visible to anon");
    ok("anon SELECT travel_time_cache returns no rows");
  });

  await run("authenticated non-admin cannot SELECT travel_time_cache", async () => {
    const { data } = await patientSess.client.from("travel_time_cache").select("id").eq("id", cacheRow.id);
    if (data && data.length > 0) return bad("authenticated non-admin cannot SELECT travel_time_cache", "row was visible to patient");
    ok("authenticated non-admin cannot SELECT travel_time_cache");
  });

  await run("admin CAN SELECT travel_time_cache", async () => {
    const { data, error } = await adminSess.client.from("travel_time_cache").select("id").eq("id", cacheRow.id);
    if (error) return bad("admin CAN SELECT travel_time_cache", error.message);
    if (!data || data.length === 0) return bad("admin CAN SELECT travel_time_cache", "admin saw no rows");
    ok("admin CAN SELECT travel_time_cache");
  });

  await run("service_role can INSERT travel_time_cache (write path intact)", async () => {
    const { data, error } = await admin.from("travel_time_cache").insert({
      origin_lat: 41.0, origin_lng: -75.0,
      dest_lat: 41.1, dest_lng: -75.1,
      mode: "driving", provider: "test",
      duration_seconds: 800, distance_meters: 6000,
    }).select("id").single();
    if (error || !data) return bad("service_role can INSERT travel_time_cache (write path intact)", error?.message);
    cacheIds.push(data.id);
    ok("service_role can INSERT travel_time_cache (write path intact)");
  });
} finally {
  if (cacheIds.length) await admin.from("travel_time_cache").delete().in("id", cacheIds);
  if (availabilityIds.length) await admin.from("provider_availability").delete().in("id", availabilityIds);
  if (providerIds.length) await admin.from("providers").delete().in("id", providerIds);
  for (const u of users) {
    try { await admin.auth.admin.deleteUser(u.userId); } catch { /* best-effort */ }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
