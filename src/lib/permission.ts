// Shared helpers for surfacing "insufficient permissions" UX across admin routes.

export type ForbiddenReason = "role" | "csrf" | "session" | "unknown";

export interface ForbiddenInfo {
  reason: ForbiddenReason;
  message: string;
  recovery: string;
}

const REASON_COPY: Record<ForbiddenReason, { message: string; recovery: string }> = {
  role: {
    message: "Admin role required",
    recovery: "Ask an existing admin to grant you the admin role from the Roles page, then reload.",
  },
  csrf: {
    message: "Request blocked for security",
    recovery: "Reload the page to refresh the request token. If the problem repeats, sign out and back in.",
  },
  session: {
    message: "Session expired",
    recovery: "Sign back in to refresh your credentials. Your last action was not applied.",
  },
  unknown: {
    message: "Insufficient permissions",
    recovery: "Confirm you are signed in as an admin. Reload and try again.",
  },
};

export function reasonFromResult(result: unknown): ForbiddenInfo | null {
  if (!result || typeof result !== "object") return null;
  const r = result as { error?: unknown; status?: unknown };
  const err = typeof r.error === "string" ? r.error.toLowerCase() : "";
  const status = typeof r.status === "number" ? r.status : null;

  if (err.includes("csrf") || err.includes("cross-origin")) return { reason: "csrf", ...REASON_COPY.csrf };
  if (status === 401 || err.includes("unauthorized") || err.includes("no authorization") || err.includes("invalid token")) {
    return { reason: "session", ...REASON_COPY.session };
  }
  if (err === "forbidden" || err.includes("forbidden") || err.includes("permission") || err === "not_admin") {
    return { reason: "role", ...REASON_COPY.role };
  }
  return null;
}

export function reasonFromError(error: unknown): ForbiddenInfo | null {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return reasonFromResult({ error: message });
}
