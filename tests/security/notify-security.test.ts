// Unit tests for scripts/ci/notify-security.ts retry semantics.
//
// Verifies:
//  - transient failures (429/5xx/network throw) are retried with backoff
//  - permanent failures (4xx) are NOT retried
//  - success on a later attempt is reported as ok
//  - notify() never throws, so the security-scan gate job cannot break
//
// Run with: bun run test:notify-security
import { notify, postWithRetry, backoffDelay, isRetryableStatus, type Payload } from "../../scripts/ci/notify-security";

let passed = 0;
let failed = 0;
const ok = (l: string) => { passed++; console.log(`  ✅ ${l}`); };
const bad = (l: string, d?: string) => { failed++; console.log(`  ❌ ${l}${d ? " — " + d : ""}`); };

const payload: Payload = {
  ok: false,
  open: [{ internal_id: "pinned_x", scanner_name: "test", title: "Reintroduced", severity: "error", status: "open", last_seen_at: new Date().toISOString() }],
  run_url: "https://example.test/run/1",
  artifact_url: "https://example.test/run/1#artifacts",
  report_url: "https://example.test/app/admin/security",
};

const noSleep = async () => {};
const res = (status: number) => new Response(status === 204 ? null : "body", { status });

console.log("\n▶ notify-security retry/backoff\n");

// ---------- backoff shape ----------
{
  const d1 = backoffDelay(1, 100);
  const d2 = backoffDelay(2, 100);
  const d3 = backoffDelay(3, 100);
  if (d1 >= 100 && d1 <= 120 && d2 >= 200 && d2 <= 240 && d3 >= 400 && d3 <= 480) ok(`exponential backoff with jitter (${d1}/${d2}/${d3}ms)`);
  else bad("exponential backoff with jitter", `${d1}/${d2}/${d3}`);

  if (isRetryableStatus(500) && isRetryableStatus(503) && isRetryableStatus(429) && !isRetryableStatus(400) && !isRetryableStatus(401) && !isRetryableStatus(404)) ok("retryable classification (429/5xx yes, 4xx no)");
  else bad("retryable classification");
}

// ---------- transient then success ----------
{
  let calls = 0;
  const r = await postWithRetry("fake", "https://x.test", {}, {
    fetchImpl: async () => { calls++; return calls < 3 ? res(503) : res(200); },
    sleep: noSleep,
    baseDelayMs: 1,
  });
  if (r.ok && r.attempts === 3 && calls === 3) ok("retries transient 5xx and succeeds on attempt 3");
  else bad("retries transient 5xx", `ok=${r.ok} attempts=${r.attempts} calls=${calls}`);
}

// ---------- network throw is retried ----------
{
  let calls = 0;
  const r = await postWithRetry("fake", "https://x.test", {}, {
    fetchImpl: async () => { calls++; if (calls === 1) throw new Error("ECONNRESET"); return res(200); },
    sleep: noSleep,
    baseDelayMs: 1,
  });
  if (r.ok && calls === 2) ok("retries network errors");
  else bad("retries network errors", `ok=${r.ok} calls=${calls}`);
}

// ---------- permanent 4xx is not retried ----------
{
  let calls = 0;
  const r = await postWithRetry("fake", "https://x.test", {}, {
    fetchImpl: async () => { calls++; return res(403); },
    sleep: noSleep,
    baseDelayMs: 1,
  });
  if (!r.ok && calls === 1 && r.attempts === 1) ok("does not retry permanent 4xx");
  else bad("does not retry permanent 4xx", `calls=${calls}`);
}

// ---------- exhausts attempts then gives up ----------
{
  let calls = 0;
  const r = await postWithRetry("fake", "https://x.test", {}, {
    fetchImpl: async () => { calls++; return res(500); },
    sleep: noSleep,
    baseDelayMs: 1,
  });
  if (!r.ok && calls === 3 && r.attempts === 3) ok("gives up after 3 attempts");
  else bad("gives up after 3 attempts", `calls=${calls}`);
}

// ---------- notify(): Slack retried, email still attempted ----------
{
  const seen: string[] = [];
  let slackCalls = 0;
  const out = await notify(payload, { slackUrl: "https://hooks.test/slack", emailTo: "a@b.test", resendKey: "re_test" }, {
    fetchImpl: async (url) => {
      seen.push(url);
      if (url.includes("slack")) { slackCalls++; return slackCalls < 2 ? res(429) : res(200); }
      return res(200);
    },
    sleep: noSleep,
    baseDelayMs: 1,
  });
  if (out.slack.ok && out.slack.attempts === 2 && out.email.ok && out.email.attempts === 1) ok("notify(): Slack 429 retried, email delivered");
  else bad("notify(): Slack 429 retried, email delivered", JSON.stringify(out));
  if (seen.some((u) => u.includes("api.resend.com"))) ok("notify(): email posted to Resend even after Slack retry");
  else bad("notify(): email posted to Resend", seen.join(","));
}

// ---------- notify(): total failure never throws ----------
{
  let threw = false;
  let out: Awaited<ReturnType<typeof notify>> | null = null;
  try {
    out = await notify(payload, { slackUrl: "https://hooks.test/slack", emailTo: "a@b.test", resendKey: "re_test" }, {
      fetchImpl: async () => { throw new Error("total outage"); },
      sleep: noSleep,
      baseDelayMs: 1,
    });
  } catch { threw = true; }
  if (!threw && out && !out.slack.ok && !out.email.ok) ok("notify(): total outage returns failure without throwing (gate stays green)");
  else bad("notify(): total outage without throwing", `threw=${threw}`);
}

// ---------- notify(): no-op paths ----------
{
  let called = false;
  const skipOk = await notify({ ...payload, ok: true, open: [] }, { slackUrl: "https://hooks.test/slack" }, { fetchImpl: async () => { called = true; return res(200); }, sleep: noSleep });
  if (skipOk.skipped && !called) ok("notify(): green gate sends nothing");
  else bad("notify(): green gate sends nothing");

  const skipCfg = await notify(payload, {}, { fetchImpl: async () => { called = true; return res(200); }, sleep: noSleep });
  if (skipCfg.skipped && !called) ok("notify(): unconfigured channels send nothing");
  else bad("notify(): unconfigured channels send nothing");
}

// ---------- notify(): email skipped without RESEND_API_KEY ----------
{
  const out = await notify(payload, { emailTo: "a@b.test" }, { fetchImpl: async () => res(200), sleep: noSleep });
  if (!out.email.attempted) ok("notify(): missing RESEND_API_KEY skips email cleanly");
  else bad("notify(): missing RESEND_API_KEY skips email cleanly");
}

console.log(`\n${passed} passed · ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
