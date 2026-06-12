// Same-origin CSRF defense-in-depth for TanStack server functions.
// Bearer-token auth already blocks CSRF (browsers do not auto-attach
// the Authorization header cross-origin), but we add an explicit
// Origin/Referer host check on all state-changing methods so a future
// cookie-based auth migration cannot silently regress.
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try { return new URL(value).host; } catch { return null; }
}

export const requireSameOrigin = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();
    if (!request) return next();
    const method = request.method.toUpperCase();
    if (!MUTATING.has(method)) return next();

    const requestHost = request.headers.get("host");
    const originHost = hostOf(request.headers.get("origin")) ?? hostOf(request.headers.get("referer"));

    // If no origin/referer at all (e.g. server-to-server fetch), allow — the
    // bearer-token check on auth middleware will still gate sensitive ops.
    if (!originHost) return next();

    if (!requestHost || originHost !== requestHost) {
      throw new Response("Forbidden: cross-origin request rejected", { status: 403 });
    }
    return next();
  },
);
