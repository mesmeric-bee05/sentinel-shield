// Structured logging + optional Sentry telemetry for security-critical events.
//
// Every event is emitted as a single-line JSON log so production log search can
// filter by `event` / `severity` / attributes. When SENTRY_DSN is configured the
// same event is forwarded to Sentry's store endpoint via plain `fetch` (no SDK,
// Worker-safe). Without a DSN the Sentry transport is a silent no-op.
//
// Server/CI use only — never import this from a React component.

export type TelemetrySeverity = "info" | "warning" | "error";

export type SecurityEvent = {
  event: string;
  severity?: TelemetrySeverity;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  message?: string;
};

export type StructuredLogLine = {
  ts: string;
  channel: "security";
  event: string;
  severity: TelemetrySeverity;
  message: string;
  attrs: Record<string, string | number | boolean | null>;
};

function cleanAttrs(attrs: SecurityEvent["attrs"]): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/** Pure formatter — shared by the emitter and the contract tests. */
export function formatSecurityEvent(e: SecurityEvent, now = new Date()): StructuredLogLine {
  const severity = e.severity ?? "info";
  return {
    ts: now.toISOString(),
    channel: "security",
    event: e.event,
    severity,
    message: e.message ?? e.event,
    attrs: cleanAttrs(e.attrs),
  };
}

type ParsedDsn = { host: string; projectId: string; publicKey: string; protocol: string };

/** Parse a Sentry DSN (https://<key>@<host>/<projectId>). Returns null when invalid. */
export function parseSentryDsn(dsn: string | undefined | null): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "").split("/").pop() ?? "";
    if (!u.username || !projectId) return null;
    return { host: u.host, projectId, publicKey: u.username, protocol: u.protocol.replace(":", "") };
  } catch {
    return null;
  }
}

/** Build the Sentry store URL + auth header for a parsed DSN. */
export function sentryStoreTarget(dsn: ParsedDsn): { url: string; headers: Record<string, string> } {
  return {
    url: `${dsn.protocol}://${dsn.host}/api/${dsn.projectId}/store/`,
    headers: {
      "content-type": "application/json",
      "x-sentry-auth": `Sentry sentry_version=7, sentry_client=apexcare-telemetry/1.0, sentry_key=${dsn.publicKey}`,
    },
  };
}

const SEVERITY_TO_SENTRY: Record<TelemetrySeverity, string> = {
  info: "info",
  warning: "warning",
  error: "error",
};

function envVar(name: string): string | undefined {
  try {
    return typeof process !== "undefined" ? process.env[name] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Emit a structured log line and (when configured) a Sentry event.
 * Never throws — telemetry must not break the request it observes.
 */
export async function emitSecurityEvent(e: SecurityEvent, opts: { fetchImpl?: typeof fetch; dsn?: string | undefined } = {}): Promise<StructuredLogLine> {
  const line = formatSecurityEvent(e);
  const serialized = JSON.stringify(line);
  if (line.severity === "error") console.error(serialized);
  else if (line.severity === "warning") console.warn(serialized);
  else console.log(serialized);

  const dsn = parseSentryDsn(opts.dsn ?? envVar("SENTRY_DSN"));
  if (!dsn) return line;

  const doFetch = opts.fetchImpl ?? fetch;
  const { url, headers } = sentryStoreTarget(dsn);
  const body = {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: line.ts,
    platform: "javascript",
    level: SEVERITY_TO_SENTRY[line.severity],
    logger: "security",
    environment: envVar("SENTRY_ENVIRONMENT") ?? envVar("NODE_ENV") ?? "production",
    message: { formatted: `${line.event}: ${line.message}` },
    tags: { event: line.event, channel: "security" },
    extra: line.attrs,
  };
  try {
    await doFetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    // Telemetry transport failures are non-fatal by design.
  }
  return line;
}

/** Fire-and-forget wrapper for hot paths that must not await the transport. */
export function emitSecurityEventAsync(e: SecurityEvent): void {
  void emitSecurityEvent(e).catch(() => undefined);
}
