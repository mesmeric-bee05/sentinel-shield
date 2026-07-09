// Post reintroduced security-gate findings to Slack (Block Kit webhook) and/or
// email (via Resend). Reads the JSON payload written by security-gate.ts and
// exits 0 when there is nothing to do. Silent no-op unless the corresponding
// secret is set, so forks / unconfigured runs stay green.
//
// Env:
//   SECURITY_GATE_OUTPUT       - path to gate JSON (default /tmp/security-gate.json)
//   SLACK_SECURITY_WEBHOOK     - Slack incoming webhook URL (optional)
//   SECURITY_ALERT_EMAIL       - Comma-separated recipient list (optional)
//   RESEND_API_KEY             - Required when SECURITY_ALERT_EMAIL is set
//   SECURITY_ALERT_FROM        - "Name <addr>" for Resend (default: alerts@apexcare.ai)
import { readFileSync } from "node:fs";

type OpenFinding = {
  internal_id: string;
  scanner_name: string;
  title: string;
  severity: string;
  status: string;
  last_seen_at: string;
};
type Payload = { ok: boolean; open: OpenFinding[]; run_url: string | null; artifact_url?: string | null; report_url?: string | null };

const OUTPUT_PATH = process.env.SECURITY_GATE_OUTPUT ?? "/tmp/security-gate.json";

let payload: Payload;
try {
  payload = JSON.parse(readFileSync(OUTPUT_PATH, "utf8")) as Payload;
} catch (e) {
  console.warn(`notify-security: could not read ${OUTPUT_PATH}: ${e instanceof Error ? e.message : e} — skipping.`);
  process.exit(0);
}

if (payload.ok || payload.open.length === 0) {
  console.log("notify-security: nothing to notify (gate ok).");
  process.exit(0);
}

const slackUrl = process.env.SLACK_SECURITY_WEBHOOK;
const emailTo = process.env.SECURITY_ALERT_EMAIL;
const resendKey = process.env.RESEND_API_KEY;
const fromAddr = process.env.SECURITY_ALERT_FROM ?? "ApexCare Security <alerts@apexcare.ai>";

if (!slackUrl && !emailTo) {
  console.log("notify-security: no SLACK_SECURITY_WEBHOOK or SECURITY_ALERT_EMAIL configured — skipping.");
  process.exit(0);
}

const findingLines = payload.open
  .map((f) => `• *${f.internal_id}* [${f.severity}] ${f.scanner_name} — ${f.title} (last_seen ${f.last_seen_at})`)
  .join("\n");

// Links block — reused across Slack and email so admins can click straight
// from the alert into the workflow run, the JSON artifact, or the in-app
// security tracker.
const links: { label: string; url: string }[] = [];
if (payload.run_url) links.push({ label: "Workflow run", url: payload.run_url });
if (payload.artifact_url) links.push({ label: "Scan artifact", url: payload.artifact_url });
if (payload.report_url) links.push({ label: "Security tracker", url: payload.report_url });

// --- Slack -----------------------------------------------------------
if (slackUrl) {
  const linkLine = links.map((l) => `<${l.url}|${l.label}>`).join("  ·  ");
  const blocks = [
    { type: "header", text: { type: "plain_text", text: `🚨 Security-scan gate: ${payload.open.length} pinned finding(s) reintroduced` } },
    { type: "section", text: { type: "mrkdwn", text: findingLines } },
    ...(linkLine ? [{ type: "context", elements: [{ type: "mrkdwn", text: linkLine }] }] : []),
  ];
  const res = await fetch(slackUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: `Security-scan gate reintroduced ${payload.open.length} finding(s)`, blocks }),
  });
  if (!res.ok) {
    console.error(`notify-security: Slack post failed [${res.status}]: ${await res.text()}`);
  } else {
    console.log("notify-security: Slack notified.");
  }
}

// --- Email (Resend) --------------------------------------------------
if (emailTo) {
  if (!resendKey) {
    console.warn("notify-security: SECURITY_ALERT_EMAIL set but RESEND_API_KEY missing — skipping email.");
  } else {
    const rows = payload.open
      .map((f) => `<tr><td><code>${f.internal_id}</code></td><td>${f.severity}</td><td>${f.scanner_name}</td><td>${f.title}</td><td>${f.last_seen_at}</td></tr>`)
      .join("");
    const html = `
      <p><strong>${payload.open.length} pinned security finding(s) reintroduced.</strong></p>
      <table border="1" cellpadding="6" cellspacing="0">
        <thead><tr><th>Internal ID</th><th>Severity</th><th>Scanner</th><th>Title</th><th>Last seen</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${payload.run_url ? `<p><a href="${payload.run_url}">View workflow run</a></p>` : ""}
    `;
    const to = emailTo.split(",").map((s) => s.trim()).filter(Boolean);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: fromAddr,
        to,
        subject: `[ApexCare] Security-scan gate: ${payload.open.length} reintroduced finding(s)`,
        html,
        text: findingLines.replace(/\*/g, ""),
      }),
    });
    if (!res.ok) {
      console.error(`notify-security: Resend send failed [${res.status}]: ${await res.text()}`);
    } else {
      console.log(`notify-security: email sent to ${to.length} recipient(s).`);
    }
  }
}
