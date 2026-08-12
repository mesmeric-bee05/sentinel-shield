// Build direct Sentry links from a telemetry correlation ID so admins can jump
// from an audit row to the correlated event and inspect the failing payload.
//
// Configure with VITE_SENTRY_ORG and VITE_SENTRY_PROJECT. Without them the UI
// renders the ID as plain text instead of a dead link.

export function sentryOrg(): string | null {
  const v = import.meta.env["VITE_SENTRY_ORG"];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function sentryProject(): string | null {
  const v = import.meta.env["VITE_SENTRY_PROJECT"];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Search link for every event sharing this correlation ID. */
export function sentrySearchUrl(correlationId: string | null | undefined, org = sentryOrg(), project = sentryProject()): string | null {
  if (!correlationId || !org) return null;
  const query = encodeURIComponent(`correlation_id:${correlationId}`);
  const projectPart = project ? `&project=${encodeURIComponent(project)}` : "";
  return `https://${org}.sentry.io/issues/?query=${query}${projectPart}&statsPeriod=90d`;
}
