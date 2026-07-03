import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Thin server fn that hands the client a fresh HMAC-signed CSRF token bound to
// the caller's user id. Called by the client attacher on demand (auth change or
// TTL expiry). The heavy crypto lives in csrf.server.ts and is only loaded
// inside the handler to keep this module client-safe.
export const getCsrfToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { issueCsrfToken } = await import("@/lib/csrf.server");
    const { token, expiresAt } = issueCsrfToken(context.userId);
    return { token, expiresAt, error: null as string | null };
  });
