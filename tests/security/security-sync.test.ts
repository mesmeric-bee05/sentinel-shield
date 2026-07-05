// Tests for /api/public/security-sync — signature verification, replay
// protection, and security_sync_attempts logging.
//
// Invokes the route handler directly (no HTTP) with fabricated Request
// objects. Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and
// SECURITY_SYNC_SECRET. Skips gracefully when any are missing.
//
// Run with: bun run test:security-sync
import { createHmac } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { Route } from "@/routes/api/public/security-sync";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SECRET = process.env.SECURITY_SYNC_SECRET;

if (!SUPABASE_URL || !SERVICE_KEY || !SECRET) {
  console.log("⏭  Skipping security-sync tests: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SECURITY_SYNC_SECRET not set.");
  process.exit(0);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handler: (ctx: { request: Request }) => Promise<Response> = (Route as any).options.server.handlers.POST;

let passed = 0;
let failed = 0;
function ok(label: string) { passed++; console.log(`  ✅ ${label}`); }
function bad(label: string, detail?: string) { failed++; console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`); }

async function run(label: string, fn: () => Promise<void>) {
  try { await fn(); } catch (e) { bad(label, e instanceof Error ? e.message : String(e)); }
}

const SCANNER = `security-sync-test-${Date.now()}`;
const testStart = new Date().toISOString();
const nonces: string[] = [];

function makeBody(nonce: string, issuedAt: string = new Date().toISOString(), findings: unknown[] = [{
  scanner_name: SCANNER,
  internal_id: `${nonce}-f1`,
  title: "security-sync test finding",
  severity: "info",
  status: "open",
}]) {
  return JSON.stringify({ nonce, issued_at: issuedAt, findings });
}

function sign(body: string, secret: string = SECRET!) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function post(body: string, sig: string): Promise<Response> {
  const req = new Request("http://localhost/api/public/security-sync", {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": sig, "x-forwarded-for": "127.0.0.1" },
    body,
  });
  return handler({ request: req });
}

try {
  // ---------- Happy path ----------
  await run("valid signature + fresh nonce → 200 accepted, row logged", async () => {
    const nonce = `t-happy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    nonces.push(nonce);
    const body = makeBody(nonce);
    const res = await post(body, sign(body));
    if (res.status !== 200) return bad("valid signature + fresh nonce → 200 accepted, row logged", `status=${res.status}`);
    const { data } = await admin
      .from("security_sync_attempts" as never)
      .select("status, signature_valid, finding_count, nonce")
      .eq("nonce", nonce)
      .maybeSingle();
    const row = data as { status?: string; signature_valid?: boolean; finding_count?: number } | null;
    if (!row) return bad("valid signature + fresh nonce → 200 accepted, row logged", "no attempt row found");
    if (row.status !== "accepted") return bad("valid signature + fresh nonce → 200 accepted, row logged", `status=${row.status}`);
    if (row.signature_valid !== true) return bad("valid signature + fresh nonce → 200 accepted, row logged", "signature_valid should be true");
    if (row.finding_count !== 1) return bad("valid signature + fresh nonce → 200 accepted, row logged", `finding_count=${row.finding_count}`);
    ok("valid signature + fresh nonce → 200 accepted, row logged");
  });

  // ---------- Replay ----------
  await run("duplicate nonce → 409 replay, second row logged with status=replay", async () => {
    const nonce = `t-replay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    nonces.push(nonce);
    const body = makeBody(nonce);
    const sig = sign(body);
    const first = await post(body, sig);
    if (first.status !== 200) return bad("duplicate nonce → 409 replay, second row logged with status=replay", `first status=${first.status}`);
    // Fresh signed body with same nonce — issued_at differs so signature differs, but nonce collides.
    const bodyReplay = makeBody(nonce, new Date().toISOString());
    const res = await post(bodyReplay, sign(bodyReplay));
    if (res.status !== 409) return bad("duplicate nonce → 409 replay, second row logged with status=replay", `status=${res.status}`);
    // Replay rows log nonce=null but signature_valid=true. Find by recent timestamp + status.
    const { data } = await admin
      .from("security_sync_attempts" as never)
      .select("status, signature_valid, error, received_at")
      .eq("status", "replay")
      .gte("received_at", testStart)
      .order("received_at", { ascending: false })
      .limit(5);
    const rows = (data ?? []) as { status: string; signature_valid: boolean; error: string | null }[];
    const match = rows.find((r) => r.signature_valid === true && (r.error ?? "").includes(nonce));
    if (!match) return bad("duplicate nonce → 409 replay, second row logged with status=replay", "no replay row referencing nonce");
    ok("duplicate nonce → 409 replay, second row logged with status=replay");
  });

  // ---------- Stale issued_at ----------
  await run("stale issued_at → 400 invalid_payload row", async () => {
    const nonce = `t-stale-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const body = makeBody(nonce, stale);
    const res = await post(body, sign(body));
    if (res.status !== 400) return bad("stale issued_at → 400 invalid_payload row", `status=${res.status}`);
    const { data } = await admin
      .from("security_sync_attempts" as never)
      .select("status, signature_valid, nonce, error")
      .eq("nonce", nonce)
      .maybeSingle();
    const row = data as { status?: string; signature_valid?: boolean; error?: string | null } | null;
    if (!row) return bad("stale issued_at → 400 invalid_payload row", "no attempt row found");
    if (row.status !== "invalid_payload") return bad("stale issued_at → 400 invalid_payload row", `status=${row.status}`);
    if (row.signature_valid !== true) return bad("stale issued_at → 400 invalid_payload row", "signature should be valid");
    if (!row.error || !/replay window|stale issued_at/i.test(row.error)) return bad("stale issued_at → 400 invalid_payload row", `error=${row.error}`);
    ok("stale issued_at → 400 invalid_payload row");
    nonces.push(nonce);
  });

  // ---------- Invalid signature ----------
  await run("wrong secret → 401 invalid_signature row (signature_valid=false, nonce=null)", async () => {
    const nonce = `t-badsig-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const body = makeBody(nonce);
    const badSig = sign(body, "wrong-secret-value");
    const res = await post(body, badSig);
    if (res.status !== 401) return bad("wrong secret → 401 invalid_signature row (signature_valid=false, nonce=null)", `status=${res.status}`);
    // Signature-fail rows always nonce=null. Find one written since testStart.
    const { data } = await admin
      .from("security_sync_attempts" as never)
      .select("status, signature_valid, nonce, received_at")
      .eq("status", "invalid_signature")
      .gte("received_at", testStart)
      .order("received_at", { ascending: false })
      .limit(1);
    const row = ((data ?? []) as { status: string; signature_valid: boolean; nonce: string | null }[])[0];
    if (!row) return bad("wrong secret → 401 invalid_signature row (signature_valid=false, nonce=null)", "no invalid_signature row found");
    if (row.signature_valid !== false) return bad("wrong secret → 401 invalid_signature row (signature_valid=false, nonce=null)", "signature_valid should be false");
    if (row.nonce !== null) return bad("wrong secret → 401 invalid_signature row (signature_valid=false, nonce=null)", `nonce=${row.nonce}`);
    ok("wrong secret → 401 invalid_signature row (signature_valid=false, nonce=null)");
  });

  // ---------- Missing signature header ----------
  await run("missing x-signature → 401 invalid_signature", async () => {
    const nonce = `t-nosig-${Date.now()}`;
    const body = makeBody(nonce);
    const req = new Request("http://localhost/api/public/security-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const res = await handler({ request: req });
    if (res.status !== 401) return bad("missing x-signature → 401 invalid_signature", `status=${res.status}`);
    ok("missing x-signature → 401 invalid_signature");
  });

  // ---------- Malformed JSON ----------
  await run("malformed JSON → 400 invalid_payload (signature_valid=true)", async () => {
    const body = "{ not valid json";
    const res = await post(body, sign(body));
    if (res.status !== 400) return bad("malformed JSON → 400 invalid_payload (signature_valid=true)", `status=${res.status}`);
    const { data } = await admin
      .from("security_sync_attempts" as never)
      .select("status, signature_valid, nonce")
      .eq("status", "invalid_payload")
      .is("nonce", null)
      .gte("received_at", testStart)
      .order("received_at", { ascending: false })
      .limit(1);
    const row = ((data ?? []) as { status: string; signature_valid: boolean }[])[0];
    if (!row) return bad("malformed JSON → 400 invalid_payload (signature_valid=true)", "no row logged");
    if (row.signature_valid !== true) return bad("malformed JSON → 400 invalid_payload (signature_valid=true)", "signature_valid should be true");
    ok("malformed JSON → 400 invalid_payload (signature_valid=true)");
  });
} finally {
  // Clean up: attempts written during the test window + findings from this scanner.
  try {
    await admin.from("security_sync_attempts" as never).delete().gte("received_at", testStart);
    await admin.from("security_findings").delete().eq("scanner_name", SCANNER);
  } catch { /* best effort */ }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
