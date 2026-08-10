// Provision Sentry alert rules for security telemetry spikes.
//
// Creates (or updates in place) three issue-alert rules so an on-call engineer
// is paged when production sees a burst of:
//   1. security-sync rate limiting          -> security.sync.rate_limited
//   2. oversized security-sync payloads     -> security.sync.payload_too_large
//   3. CI notifier retry exhaustion         -> notifier.retry_failed
//
// The rules match on the `event` tag emitted by src/lib/telemetry.ts, so the
// taxonomy in docs/telemetry.md is the contract this script depends on.
//
// Usage:  bun run scripts/ci/sentry-alerts.ts            (dry run without creds)
//         SENTRY_AUTH_TOKEN=... SENTRY_ORG=... SENTRY_PROJECT=... bun run sentry:alerts
//
// Without SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT the script prints the
// intended rules and exits 0 — it must never break a CI job.

export type AlertRuleSpec = {
  /** Stable name used as the upsert key. */
  name: string;
  /** Telemetry event tag this rule watches. */
  event: string;
  /** Number of occurrences that trips the alert. */
  threshold: number;
  /** Rolling window: one of Sentry's supported intervals. */
  interval: "1m" | "5m" | "15m" | "1h" | "1d";
  /** Minutes to wait before re-alerting on the same issue. */
  frequency: number;
};

export const ALERT_RULES: AlertRuleSpec[] = [
  {
    name: "Security sync rate limiting spike",
    event: "security.sync.rate_limited",
    threshold: 10,
    interval: "5m",
    frequency: 30,
  },
  {
    name: "Security sync payload too large spike",
    event: "security.sync.payload_too_large",
    threshold: 5,
    interval: "5m",
    frequency: 30,
  },
  {
    name: "Security notifier retry failures",
    event: "notifier.retry_failed",
    threshold: 3,
    interval: "15m",
    frequency: 60,
  },
];

const SENTRY_HOST = process.env["SENTRY_HOST"] ?? "https://sentry.io";

/** Sentry issue-alert payload for one spec. Pure — unit tested. */
export function buildRulePayload(spec: AlertRuleSpec, environment: string | null = null) {
  return {
    name: spec.name,
    actionMatch: "all",
    filterMatch: "all",
    frequency: spec.frequency,
    environment,
    conditions: [
      {
        id: "sentry.rules.conditions.event_frequency.EventFrequencyCondition",
        value: spec.threshold,
        interval: spec.interval,
      },
    ],
    filters: [
      {
        id: "sentry.rules.filters.tagged_event.TaggedEventFilter",
        key: "event",
        match: "eq",
        value: spec.event,
      },
    ],
    actions: [
      {
        id: "sentry.mail.actions.NotifyEmailAction",
        targetType: "IssueOwners",
        fallthroughType: "ActiveMembers",
      },
    ],
  };
}

type ExistingRule = { id: string; name: string };

async function api(path: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SENTRY_HOST}/api/0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export async function provisionAlertRules(): Promise<{ skipped: boolean; created: string[]; updated: string[]; failed: string[] }> {
  const token = process.env["SENTRY_AUTH_TOKEN"];
  const org = process.env["SENTRY_ORG"];
  const project = process.env["SENTRY_PROJECT"];
  const environment = process.env["SENTRY_ENVIRONMENT"] ?? null;

  if (!token || !org || !project) {
    console.log("⏭  Sentry alert provisioning skipped (SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT not set).");
    for (const spec of ALERT_RULES) {
      console.log(`   would ensure: "${spec.name}" — ${spec.event} > ${spec.threshold} per ${spec.interval}`);
    }
    return { skipped: true, created: [], updated: [], failed: [] };
  }

  const listRes = await api(`/projects/${org}/${project}/rules/`, token);
  if (!listRes.ok) {
    console.error(`❌ Could not list Sentry rules (${listRes.status}). Nothing changed.`);
    return { skipped: false, created: [], updated: [], failed: ALERT_RULES.map((r) => r.name) };
  }
  const existing = (await listRes.json()) as ExistingRule[];

  const created: string[] = [];
  const updated: string[] = [];
  const failed: string[] = [];

  for (const spec of ALERT_RULES) {
    const match = existing.find((r) => r.name === spec.name);
    const body = JSON.stringify(buildRulePayload(spec, environment));
    const res = match
      ? await api(`/projects/${org}/${project}/rules/${match.id}/`, token, { method: "PUT", body })
      : await api(`/projects/${org}/${project}/rules/`, token, { method: "POST", body });

    if (res.ok) {
      (match ? updated : created).push(spec.name);
      console.log(`${match ? "🔁 updated" : "✅ created"} "${spec.name}"`);
    } else {
      failed.push(spec.name);
      console.error(`❌ "${spec.name}" failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
  }

  console.log(`\nSentry alert rules — created ${created.length}, updated ${updated.length}, failed ${failed.length}`);
  return { skipped: false, created, updated, failed };
}

if (import.meta.main) {
  const result = await provisionAlertRules();
  // Never fail the pipeline on alert provisioning; surface via logs instead.
  if (result.failed.length > 0) console.error("Some alert rules were not provisioned — see errors above.");
  process.exit(0);
}
