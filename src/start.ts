import { createStart } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { attachCsrfToken } from "@/integrations/supabase/csrf-attacher";
import { requireSameOrigin, verifyCsrfHeader } from "@/integrations/supabase/csrf-middleware";

export const startInstance = createStart(() => ({
  // Client middleware order matters:
  //  1. attachSupabaseAuth — attaches the bearer token so the server can id the user.
  //  2. attachCsrfToken    — attaches x-csrf-token (in-memory cache, HMAC-signed).
  // Server middleware:
  //  1. requireSameOrigin  — rejects cross-origin mutating requests.
  //  2. verifyCsrfHeader   — verifies HMAC token on authenticated mutating requests.
  functionMiddleware: [attachSupabaseAuth, attachCsrfToken, requireSameOrigin, verifyCsrfHeader],
}));
