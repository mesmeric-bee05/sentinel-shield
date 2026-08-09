// Client-side CSRF token cache + attacher middleware.
// - In-memory only (never localStorage).
// - Fetched on demand via the getCsrfToken server fn.
// - Auto-refreshed when TTL < 10 min remaining OR when a request comes back
//   with 403 csrf_invalid / csrf_missing.
import { createMiddleware } from "@tanstack/react-start";
import { getCsrfToken } from "@/lib/csrf.functions";
import { supabase } from "@/integrations/supabase/client";

let cache: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;
// True while the bootstrap getCsrfToken call is in flight. That call goes
// through this same client middleware, so without this flag it would await its
// own `inflight` promise and deadlock every server function in the app.
let bootstrapping = false;

const REFRESH_WINDOW_MS = 10 * 60 * 1000;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function fetchToken(): Promise<string | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // Only bother requesting a token when we have a session — anonymous callers
      // do not need CSRF (server middleware skips them anyway).
      const { data } = await supabase.auth.getSession();
      if (!data.session) return null;
      bootstrapping = true;
      let r: { token: string; expiresAt: number } | null = null;
      try {
        r = await getCsrfToken({ data: undefined as never });
      } finally {
        bootstrapping = false;
      }
      if (r && r.token) {
        cache = { token: r.token, expiresAt: r.expiresAt };
        return r.token;
      }
      return null;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function getToken(force = false): Promise<string | null> {
  const now = Date.now();
  if (!force && cache && cache.expiresAt - now > REFRESH_WINDOW_MS) return cache.token;
  cache = null;
  return fetchToken();
}

// Reset cache on identity changes so a new user does not reuse the previous
// user's token (verify would fail anyway; this avoids the wasted round-trip).
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
      cache = null;
    }
  });
}

export const attachCsrfToken = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    // Attach only for mutating methods. Read fns get no header (and server
    // middleware skips them). We cannot introspect method here easily, so attach
    // unconditionally; the extra header is harmless for GETs.
    if (bootstrapping) return next();
    const token = await getToken(false);
    const headers: Record<string, string> = token ? { "x-csrf-token": token } : {};
    const result = await next({ headers });
    return result;
  },
);

// Expose a manual invalidator for the rare cases where a caller wants to force
// a token refresh (e.g. after a security-sensitive UI action).
export function invalidateCsrfToken() { cache = null; }
