// Post reintroduced security-gate findings to Slack (Block Kit webhook) and/or
// email (via Resend). Reads the JSON payload written by security-gate.ts and
// exits 0 when there is nothing to do. Silent no-op unless the corresponding
// secret is set, so forks / unconfigured runs stay green.
//
// Transient failures (network errors, 429, 5xx) are retried with exponential
// backoff. The notifier NEVER changes the gate job's outcome: whatever happens
// here, the process exits 0.
//
// Env:
//   SECURITY_GATE_OUTPUT       - path to gate JSON (default /tmp/security-gate.json)
//   SLACK_SECURITY_WEBHOOK     - Slack incoming webhook URL (optional)
//   SECURITY_ALERT_EMAIL       - Comma-separated recipient list (optional)
//   RESEND_API_KEY             - Required when SECURITY_ALERT_EMAIL is set
//   SECURITY_ALERT_FROM        - "Name <addr>" for Resend (default: alerts@apexcare.ai)
import { readFileSync } from "node:fs";

export type OpenFinding = {
  internal_id: string;
  scanner_name: string;
  title: string;
  severity: string;
  status: string;
  last_seen_at: string;
};
export type Payload = {
  ok: boolean;
  open: OpenFinding[];
  run_url: string | null;
  artifact_url?: string | null;
  report_url?: string | null;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type NotifyEnv = {
  slackUrl?: string | undefined;
  emailTo?: string | undefined;
  resendKey?: string | undefined;
  fromAddr?: string | undefined;
};

export type NotifyResult = {
  slack: { attempted: boolean; ok: boolean; attempts: number; error?: string };
  email: { attempted: boolean; ok: boolean; attempts: number; error?: string };
  skipped: boolean;
};

export const MAX_ATTEMPTS = 3;
export const BASE_DELAY_MS = 500;

/** Retryable = network throw, 429, or any 5xx. 4xx (except 429) is permanent. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function backoffDelay(attempt: number, base = BASE_DELAY_MS): number {
  // attempt is 1-based: 500ms, 1000ms, 2000ms (+ up to 20% jitter).
  const exp = base * 2 ** (attempt - 1);
  return Math.round(exp * (1 + Math.random() * 0.2));
}

/**
 * POST with exponential backoff. Never throws — returns the outcome so the
 * caller can log it and still exit 0.
 */
export async function postWithRetry(
  label: string,
  url: string,
  init: RequestInit,
  opts: { fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void>; maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<{ ok: boolean; attempts: number; status?: number; error?: string }> {
  const doFetch = opts.fetchImpl ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  let lastError = "unknown";
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await doFetch(url, init);
      if (res.ok) return { ok: true, attempts: attempt, status: res.status };
      lastStatus = res.status;
      let bodyText = "";
      try { bodyText = await res.text(); } catch { /* ignore */ }
      lastError = `[${res.status}] ${bodyText}`;
      if (!isRetryableStatus(res.status)) {
        console.error(`notify-security: ${label} failed permanently ${lastError}`);
        return { ok: false, attempts: attempt, status: res.status, error: lastError };
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (attempt < maxAttempts) {
      const delay = backoffDelay(attempt, opts.baseDelayMs ?? BASE_DELAY_MS);
      console.warn(`notify-security: ${label} attempt ${attempt}/${maxAttempts} failed (${lastError}) — retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  console.error(`notify-security: ${label} gave up after ${maxAttempts} attempts: ${lastError}`);
  return { ok: false, attempts: maxAttempts, ...(lastStatus !== undefined ? { status: lastStatus } : {}), error: lastError };
}

export function buildLinks(payload: Payload): { label: string; url: string }[] {
  const links: { label: string; url: string }[] = [];
  if (payload.run_url) links.push({ label: "Workflow run", url: payload.run_url });
  if (payload.artifact_url) links.push({ label: "Scan artifact", url: payload.artifact_url });
  if (payload.report_url) links.push({ label: "Security tracker", url: payload.report_url });
  return links;
}

export function findingLines(payload: Payload): string {
  return payload.open
    .map((f) => `• *${f.internal_id}* [${f.severity}] ${f.scanner_name} — ${f.title} (last_seen ${f.last_seen_at})`)
    .join("\n");
}

/**
 * Fan out a gate payload to the configured channels. Pure with respect to
 * process state so tests can drive it with a fake fetch.
 */
export async function notify(
  payload: Payload,
  env: NotifyEnv,
  opts: { fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void>; maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<NotifyResult> {
  const result: NotifyResult = {
    slack: { attempted: false, ok: false, attempts: 0 },
    email: { attempted: false, ok: false, attempts: 0 },
    skipped: false,
  };

  if (payload.ok || payload.open.length === 0) {
    result.skipped = true;
    console.log("notify-security: nothing to notify (gate ok).");
    return result;
  }
  if (!env.slackUrl && !env.emailTo) {
    result.skipped = true;
    console.log("notify-security: no SLACK_SECURITY_WEBHOOK or SECURITY_ALERT_EMAIL configured — skipping.");
    return result;
  }

  const lines = findingLines(payload);
  const links = buildLinks(payload);

  // --- Slack ---------------------------------------------------------
  if (env.slackUrl) {
    const linkLine = links.map((l) => `<${l.url}|${l.label}>`).join("  ·  ");
    const blocks = [
      { type: "header", text: { type: "plain_text", text: `🚨 Security-scan gate: ${payload.open.length} pinned finding(s) reintroduced` } },
      { type: "section", text: { type: "mrkdwn", text: lines } },
      ...(linkLine ? [{ type: "context", elements: [{ type: "mrkdwn", text: linkLine }] }] : []),
    ];
    result.slack.attempted = true;
    const r = await postWithRetry("Slack", env.slackUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `Security-scan gate reintroduced ${payload.open.length} finding(s)`, blocks }),
    }, opts);
    result.slack.ok = r.ok;
    result.slack.attempts = r.attempts;
    if (r.error) result.slack.error = r.error;
    if (r.ok) console.log(`notify-security: Slack notified (attempt ${r.attempts}).`);
  }

  // --- Email (Resend) ------------------------------------------------
  if (env.emailTo) {
    if (!env.resendKey) {
      console.warn("notify-security: SECURITY_ALERT_EMAIL set but RESEND_API_KEY missing — skipping email.");
      return result;
    }
    const rows = payload.open
      .map((f) => `<tr><td><code>${f.internal_id}</code></td><td>${f.severity}</td><td>${f.scanner_name}</td><td>${f.title}</td><td>${f.last_seen_at}</td></tr>`)
      .join("");
    const html = `
      <p><strong>${payload.open.length} pinned security finding(s) reintroduced.</strong></p>
      <table border="1" cellpadding="6" cellspacing="0">
        <thead><tr><th>Internal ID</th><th>Severity</th><th>Scanner</th><th>Title</th><th>Last seen</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${links.length ? `<p>${links.map((l) => `<a href="${l.url}">${l.label}</a>`).join(" · ")}</p>` : ""}
    `;
    const to = env.emailTo.split(",").map((s) => s.trim()).filter(Boolean);
    result.email.attempted = true;
    const r = await postWithRetry("Resend", "https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.resendKey}` },
      body: JSON.stringify({
        from: env.fromAddr ?? "ApexCare Security <alerts@apexcare.ai>",
        to,
        subject: `[ApexCare] Security-scan gate: ${payload.open.length} reintroduced finding(s)`,
        html,
        text: lines.replace(/\*/g, ""),
      }),
    }, opts);
    result.email.ok = r.ok;
    result.email.attempts = r.attempts;
    if (r.error) result.email.error = r.error;
    if (r.ok) console.log(`notify-security: email sent to ${to.length} recipient(s) (attempt ${r.attempts}).`);
  }

  return result;
}

export function readPayload(path: string): Payload | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Payload;
  } catch (e) {
    console.warn(`notify-security: could not read ${path}: ${e instanceof Error ? e.message : e} — skipping.`);
    return null;
  }
}

export async function main(): Promise<void> {
  const payload = readPayload(process.env.SECURITY_GATE_OUTPUT ?? "/tmp/security-gate.json");
  if (!payload) return;
  await notify(payload, {
    slackUrl: process.env.SLACK_SECURITY_WEBHOOK,
    emailTo: process.env.SECURITY_ALERT_EMAIL,
    resendKey: process.env.RESEND_API_KEY,
    fromAddr: process.env.SECURITY_ALERT_FROM,
  });
}

// Only run when executed directly (tests import the helpers above).
if (import.meta.main) {
  // Delivery problems must never fail the security-scan job.
  await main().catch((e) => console.error(`notify-security: unexpected error — ${e instanceof Error ? e.message : e}`));
  process.exit(0);
}
