// CSRF defense-in-depth for TanStack server functions.
//
// Two middlewares:
//  1. requireSameOrigin — request middleware, rejects cross-origin mutating
//     requests based on Origin/Referer host comparison.
//  2. verifyCsrfHeader — function middleware, verifies the HMAC-signed
//     x-csrf-token header on mutating requests when the caller is authenticated.
//     Read-only requests and unauthenticated requests are skipped (bearer
//     auth already covers the auth surface).
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

// CSRF verification runs on every server function call. It only enforces when
// the request is a mutating method AND carries an Authorization bearer token
// (i.e. an authenticated user session). Public read-only calls and endpoints
// that do not require auth (bootstrap, sign-in helpers) are unaffected.
export const verifyCsrfHeader = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();
    if (!request) return next();
    const method = request.method.toUpperCase();
    if (!MUTATING.has(method)) return next();

    const auth = request.headers.get("authorization");
    if (!auth || !auth.toLowerCase().startsWith("bearer ")) return next();

    const token = request.headers.get("x-csrf-token");
    // Route the special getCsrfToken bootstrap fn through — it is how the client
    // acquires a token in the first place. TanStack encodes the server-fn id as
    // a base64 JSON blob in the path, so the raw path never literally contains
    // the export name: decode each path segment before matching, otherwise the
    // bootstrap call itself is rejected and NO authenticated mutation can ever
    // obtain a token (every booking / CHW action then fails with 403).
    const url = new URL(request.url);
    if (isCsrfBootstrapRequest(url)) {
      return next();
    }
    if (!token) {
      throw new Response("csrf_missing", { status: 403 });
    }


    // Decode the bearer to get the sub without a full JWT verify — we only need
    // the userId for HMAC binding; auth-middleware still validates the token.
    let userId: string | null = null;
    try {
      const parts = auth.slice(7).split(".");
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
        userId = typeof payload.sub === "string" ? payload.sub : null;
      }
    } catch { /* fallthrough */ }
    if (!userId) return next(); // let auth middleware reject invalid bearer downstream

    const { verifyCsrfToken } = await import("@/lib/csrf.server");
    if (!verifyCsrfToken(userId, token)) {
      throw new Response("csrf_invalid", { status: 403 });
    }
    return next();
  },
);
